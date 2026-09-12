package com.fruitfly.brain.tools;

import com.fruitfly.brain.Connectome;
import com.fruitfly.brain.LifConfig;
import com.fruitfly.brain.LifNetwork;
import com.fruitfly.brain.MotorDecoder;
import com.fruitfly.brain.MotorMap;
import com.fruitfly.brain.PopulationIndex;
import com.fruitfly.brain.RetinaGeometry;
import com.fruitfly.brain.SensoryEncoders;
import com.fruitfly.brain.SensoryFrame;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.InputStream;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.locks.LockSupport;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Local HTTP observation/stimulus bridge for the cinema app. Uses the actual bundled connectome and the same
 * calibrated sensory encoder and motor decoder as EmbodiedBench; no Minecraft or third-party Java dependency.
 *
 * <p>One thread owns all mutable neural state. HTTP readers receive a complete immutable JSON snapshot and writers
 * use a bounded FIFO control queue. Stimulus duration and population rates use simulated time.
 * {@code totalSpikes} means spikes in the current {@code windowMs} observation window; {@code cumulativeSpikes}
 * is the run total. {@code activeNeurons} is the integrator's active set, not a count of neurons spiking this window.
 * Motor values are the existing model's normalized readouts, not measured animal behavior.</p>
 *
 * <p>Looming uses the existing analytic LC4/LPLC2 feature input alongside the retinal image; it is not an emergent
 * vision claim. Touch represents dust/bristle stimulation on the head. Clear removes the external stimulus but
 * preserves ongoing network state and the constant 0.6 ambient luminance. POST /reset explicitly starts a new
 * trial: network, encoder adaptation, decoder state, and random seed are reinitialized without changing calibration.</p>
 */
public final class CinemaBridge implements AutoCloseable {
    private static final double TICK_MS = 50;
    private static final long TICK_NANOS = 50_000_000;
    private static final Set<String> KINDS = Set.of("sugar", "bitter", "loom", "touch", "odor", "clear");
    private static final Pattern FIELD = Pattern.compile(
            "\\s*\"([a-zA-Z]+)\"\\s*:\\s*(\"[a-zA-Z]+\"|-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)\\s*");
    private static final String[][] POPULATIONS = {
            {"MN9", "MN9"}, {"G2N-1", "GNG232"}, {"Fudog", "DNg67"},
            {"DNp01", "DNp01"}, {"LC4", "LC4"}, {"LPLC2", "LPLC2"},
            {"aDN1", "DNg62"}, {"aDN2", "DNge078"}, {"ORN_DM1", "ORN_DM1"},
            {"Sugar GRNs", "LB3b,LB3c"}, {"Bitter GRNs", "LB1a,LB1b,LB1c,LB1d"},
            {"DNp09", "DNp09"}, {"DNa02", "DNa02"}, {"Wing motor", "subclass:wm"},
            {"Kenyon cells", "prefix:KC"}
    };

    /** Validated external drive. The bridge accepts one active modality at a time. */
    public record Stimulus(String kind, double intensity, double durationMs) {
        private static Stimulus clear() { return new Stimulus("clear", 0, 0); }
    }

    private record Control(Stimulus stimulus, boolean reset) { }

    private final Connectome connectome;
    private final LifConfig config;
    private final PopulationIndex index;
    private LifNetwork network;
    private final RetinaGeometry retina;
    private SensoryEncoders encoder;
    private MotorDecoder decoder;
    private final int[][] populations;
    private final HttpServer server;
    private final ExecutorService httpExecutor = Executors.newVirtualThreadPerTaskExecutor();
    private final Thread brainThread;
    private final ArrayBlockingQueue<Control> pending = new ArrayBlockingQueue<>(32);
    private volatile boolean running = true;
    private volatile Throwable failure;
    private volatile byte[] snapshot;
    private long trial;
    private long resetAt;

    /** Constructs a stopped loopback bridge; port 0 chooses an available port (useful for embedded callers/tests). */
    public CinemaBridge(Connectome c, LifConfig config, int port) throws IOException {
        connectome = c;
        this.config = config.copy();
        index = new PopulationIndex(c);
        retina = new RetinaGeometry(c);
        initializeNeuralState();
        populations = new int[POPULATIONS.length][];
        for (int i = 0; i < populations.length; i++) populations[i] = index.resolve(POPULATIONS[i][1]);
        snapshot = makeSnapshot(0, 0, 1, MotorDecoder.MotorCommand.idle(), Stimulus.clear(), 0);
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", port), 16);
        server.setExecutor(httpExecutor);
        server.createContext("/", this::handle);
        brainThread = new Thread(this::run, "fruitfly-cinema-brain");
        brainThread.setDaemon(true);
    }

    public void start() { server.start(); brainThread.start(); }
    public int port() { return server.getAddress().getPort(); }

    private void initializeNeuralState() {
        // Only called before start or on the brain owner thread. The loaded graph and watched indices are reused.
        network = new LifNetwork(connectome, config.copy());
        network.setPostsynapticGain(index.resolve("prefix:KC"), 0.25);
        SensoryEncoders.Params params = new SensoryEncoders.Params();
        params.ornRMax = 120;
        encoder = new SensoryEncoders(connectome, index, retina, params);
        decoder = new MotorDecoder(index);
    }

    public static void main(String[] args) throws Exception {
        Path data = Path.of("src/main/resources/connectome/malecns-v1.0.flyb.gz");
        int port = 8766;
        LifConfig config = new LifConfig();
        config.dtMs = 0.5;
        // No spike raster is exported here; skip reservoir sampling work (this changes the seeded RNG sequence).
        config.spikeLogCapacity = 0;
        for (int i = 0; i < args.length; i += 2) {
            if (i + 1 >= args.length) throw new IllegalArgumentException("Expected a value after " + args[i]);
            switch (args[i]) {
                case "--flyb" -> data = Path.of(args[i + 1]);
                case "--port" -> port = Integer.parseInt(args[i + 1]);
                case "--threads" -> config.threads = Integer.parseInt(args[i + 1]);
                default -> throw new IllegalArgumentException("Unknown argument " + args[i]);
            }
        }
        if (port < 1 || port > 65535) throw new IllegalArgumentException("Port must be between 1 and 65535");
        if (config.threads < 0) throw new IllegalArgumentException("Threads must be 0 (auto) or positive");
        System.out.println("Loading the real MaleCNS connectome from " + data.toAbsolutePath());
        Connectome c;
        try (InputStream in = Files.newInputStream(data)) { c = Connectome.load(in); }
        CinemaBridge bridge = new CinemaBridge(c, config, port);
        Runtime.getRuntime().addShutdownHook(new Thread(bridge::close));
        bridge.start();
        System.out.printf("Brain ready: http://127.0.0.1:%d — %,d graph nodes, %,d directed edges%n", port, c.n, c.nEdges);
        System.out.println("50 ms windows; dt=0.5 ms; synaptic gain=0.65; KC gain=0.25; ORN maximum=120 Hz.");
    }

    private void run() {
        Stimulus current = Stimulus.clear();
        double remaining = 0;
        long sequence = 0;
        long previousSpikes = 0;
        double speed = 1;
        SensoryFrame frame = new SensoryFrame();
        frame.luminance = new float[retina.columnCount()];
        try {
            while (running) {
                long start = System.nanoTime();
                Control next = pending.poll();
                if (next != null) {
                    if (next.reset) {
                        initializeNeuralState();
                        current = Stimulus.clear();
                        remaining = 0;
                        previousSpikes = 0;
                        speed = 1;
                        trial++;
                        resetAt = System.currentTimeMillis();
                    } else { current = next.stimulus; remaining = current.durationMs; }
                }
                if (remaining <= 0) current = Stimulus.clear();
                frame.clear();
                Arrays.fill(frame.luminance, 0.6f);
                fillStimulus(frame, current, current.durationMs - remaining);
                encoder.apply(frame, network, TICK_MS);
                network.runMs(TICK_MS);
                MotorDecoder.MotorCommand motors = decoder.update(network, TICK_MS);
                long spikeCount = network.totalSpikes();
                double wallMs = (System.nanoTime() - start) / 1_000_000.0;
                speed = 0.9 * speed + 0.1 * Math.min(1, TICK_MS / Math.max(0.001, wallMs));
                remaining = Math.max(0, remaining - TICK_MS);
                snapshot = makeSnapshot(++sequence, spikeCount - previousSpikes, speed, motors, current, remaining);
                previousSpikes = spikeCount;
                network.endTick(TICK_MS);
                long rest = TICK_NANOS - (System.nanoTime() - start);
                if (rest > 0) LockSupport.parkNanos(rest);
            }
        } catch (Throwable error) {
            failure = error;
            error.printStackTrace(System.err);
        }
    }

    private void fillStimulus(SensoryFrame frame, Stimulus stimulus, double elapsedMs) {
        float intensity = (float) stimulus.intensity;
        if (intensity <= 0) return;
        switch (stimulus.kind) {
            case "sugar" -> {
                frame.addTaste("LgLG3", intensity);
                frame.addTaste("LB3b", intensity);
                frame.addTaste("LB3c", intensity);
                for (String type : new String[]{"PhG1a", "PhG1b", "PhG1c"}) frame.addTaste(type, intensity * 0.9f);
            }
            case "bitter" -> {
                frame.addTaste("LgAG1", intensity);
                for (String type : new String[]{"LB1a", "LB1b", "LB1c", "LB1d"}) frame.addTaste(type, intensity);
            }
            case "odor" -> {
                frame.addOdor("DM1", intensity);
                frame.addOdor("DM2", intensity * 0.9f);
                frame.addOdor("VA2", intensity * 0.6f);
                frame.odorBearingDeg = 40;
            }
            case "touch" -> frame.groomDust = intensity * 0.6f;
            case "loom" -> {
                // Repeat the same expanding-disc stimulus as EmbodiedBench every 1.2 simulated seconds.
                Arrays.fill(frame.luminance, 0.8f);
                double phase = elapsedMs % 1200;
                if (phase >= 200 && phase < 750) {
                    double s = Math.min(1, (phase - 200) / 500);
                    float size = (float) (5 + 85 * s * s);
                    for (int column : retina.columnsWithin(60, 0, size / 2)) frame.luminance[column] = 0.8f - 0.75f * intensity;
                    SensoryFrame.VisualObject object = new SensoryFrame.VisualObject(60, 0, size, (float) (340 * s), 0, false);
                    object.contrast = intensity;
                    frame.objects.add(object);
                }
            }
            default -> { }
        }
    }

    private byte[] makeSnapshot(long sequence, long spikes, double speed, MotorDecoder.MotorCommand motors,
                                Stimulus stimulus, double remainingMs) {
        StringBuilder json = new StringBuilder(2200);
        json.append("{\"source\":\"connectome\",\"timestamp\":").append(System.currentTimeMillis())
                .append(",\"sequence\":").append(sequence)
                .append(",\"trial\":").append(trial)
                .append(",\"resetAt\":").append(resetAt)
                .append(",\"simulatedMs\":").append(network.simTimeMs())
                .append(",\"windowMs\":").append(TICK_MS)
                .append(",\"neurons\":").append(connectome.n)
                .append(",\"edges\":").append(connectome.nEdges)
                .append(",\"totalSpikes\":").append(spikes)
                .append(",\"cumulativeSpikes\":").append(network.totalSpikes())
                .append(",\"activeNeurons\":").append(network.activeNeurons())
                .append(",\"realTimeFactor\":").append(speed)
                .append(",\"populations\":[");
        for (int i = 0; i < populations.length; i++) {
            if (i > 0) json.append(',');
            json.append("{\"name\":\"").append(POPULATIONS[i][0])
                    .append("\",\"type\":\"").append(POPULATIONS[i][1])
                    .append("\",\"hz\":").append(network.populationRateHz(populations[i], TICK_MS))
                    .append(",\"count\":").append(populations[i].length).append('}');
        }
        json.append("],\"motors\":{\"forward\":").append(motors.forward)
                .append(",\"yaw\":").append(motors.yaw)
                .append(",\"feed\":").append(motors.feed)
                .append(",\"groom\":").append(motors.groom())
                .append(",\"escape\":").append(motors.channels.getOrDefault(MotorMap.JUMP, 0.0))
                .append(",\"flight\":").append(motors.flightPower)
                .append("},\"stimulus\":{\"kind\":\"").append(stimulus.kind)
                .append("\",\"intensity\":").append(stimulus.intensity)
                .append(",\"remainingMs\":").append(remainingMs).append("}}");
        return json.toString().getBytes(StandardCharsets.UTF_8);
    }

    private void handle(HttpExchange exchange) throws IOException {
        try {
            // No CORS is needed: the app's server-side route proxies these loopback endpoints.
            String origin = exchange.getRequestHeaders().getFirst("Origin");
            if (origin != null && !localOrigin(origin)) { reply(exchange, 403, "{\"error\":\"Local clients only\"}"); return; }
            String path = exchange.getRequestURI().getPath();
            String method = exchange.getRequestMethod();
            if (path.equals("/health") && method.equals("GET")) {
                reply(exchange, failure == null ? 200 : 503, failure == null
                        ? "{\"ok\":true,\"source\":\"connectome\",\"neurons\":" + connectome.n + ",\"edges\":" + connectome.nEdges + "}"
                        : "{\"ok\":false,\"error\":\"Brain simulation stopped; inspect the bridge terminal\"}");
            } else if (path.equals("/state") && method.equals("GET")) {
                if (failure != null) reply(exchange, 503, "{\"error\":\"Brain simulation stopped; inspect the bridge terminal\"}");
                else reply(exchange, 200, snapshot);
            } else if ((path.equals("/stimulus") || path.equals("/reset")) && method.equals("POST")) {
                if (failure != null) { reply(exchange, 503, "{\"error\":\"Brain simulation stopped\"}"); return; }
                String contentType = exchange.getRequestHeaders().getFirst("Content-Type");
                if (contentType == null || !contentType.split(";", 2)[0].trim().equalsIgnoreCase("application/json")) {
                    reply(exchange, 415, "{\"error\":\"Expected application/json\"}"); return;
                }
                byte[] body = exchange.getRequestBody().readNBytes(1025);
                if (body.length > 1024) { reply(exchange, 413, "{\"error\":\"Control body exceeds 1024 bytes\"}"); return; }
                if (path.equals("/reset")) {
                    String payload = new String(body, StandardCharsets.UTF_8).strip();
                    if (!payload.isEmpty() && !payload.matches("\\{\\s*}")) {
                        reply(exchange, 400, "{\"error\":\"Reset accepts an empty JSON object\"}"); return;
                    }
                    if (!pending.offer(new Control(null, true))) {
                        reply(exchange, 429, "{\"error\":\"Brain control queue is full; retry shortly\"}"); return;
                    }
                    reply(exchange, 202, "{\"accepted\":true,\"action\":\"reset\"}");
                    return;
                }
                try {
                    Stimulus stimulus = parseStimulus(new String(body, StandardCharsets.UTF_8));
                    if (!pending.offer(new Control(stimulus, false))) {
                        reply(exchange, 429, "{\"error\":\"Brain control queue is full; retry shortly\"}"); return;
                    }
                    reply(exchange, 202, "{\"accepted\":true,\"kind\":\"" + stimulus.kind + "\"}");
                } catch (IllegalArgumentException invalid) {
                    reply(exchange, 400, "{\"error\":\"Expected kind sugar/bitter/loom/touch/odor/clear, intensity 0..1 and durationMs 0..15000\"}");
                }
            } else if (Set.of("/health", "/state", "/stimulus", "/reset").contains(path)) {
                exchange.getResponseHeaders().set("Allow", path.equals("/stimulus") || path.equals("/reset") ? "POST" : "GET");
                reply(exchange, 405, "{\"error\":\"Method not allowed\"}");
            } else reply(exchange, 404, "{\"error\":\"Not found\"}");
        } finally { exchange.close(); }
    }

    private static boolean localOrigin(String origin) {
        try {
            URI uri = URI.create(origin);
            return ("http".equals(uri.getScheme()) || "https".equals(uri.getScheme()))
                    && ("localhost".equals(uri.getHost()) || "127.0.0.1".equals(uri.getHost()) || "[::1]".equals(uri.getHost()));
        } catch (IllegalArgumentException invalid) { return false; }
    }

    /** Strictly parses the deliberately small, flat input contract without needing a JSON library. */
    public static Stimulus parseStimulus(String body) {
        String value = body.strip();
        if (!value.startsWith("{") || !value.endsWith("}")) throw new IllegalArgumentException("Expected object");
        Map<String, String> fields = new HashMap<>();
        String inside = value.substring(1, value.length() - 1);
        int offset = 0;
        while (offset < inside.length()) {
            Matcher match = FIELD.matcher(inside).region(offset, inside.length());
            if (!match.lookingAt()) throw new IllegalArgumentException("Invalid field");
            if (fields.putIfAbsent(match.group(1), match.group(2)) != null) throw new IllegalArgumentException("Duplicate field");
            offset = match.end();
            if (offset < inside.length()) {
                if (inside.charAt(offset++) != ',' || inside.substring(offset).isBlank()) throw new IllegalArgumentException("Invalid separator");
            }
        }
        if (!Set.of("kind", "intensity", "durationMs").containsAll(fields.keySet())) throw new IllegalArgumentException("Unknown field");
        String rawKind = fields.getOrDefault("kind", "");
        if (!rawKind.startsWith("\"") || !rawKind.endsWith("\"")) throw new IllegalArgumentException("Expected kind string");
        String kind = rawKind.substring(1, rawKind.length() - 1);
        if (!KINDS.contains(kind)) throw new IllegalArgumentException("Unknown kind");
        double intensity = Double.parseDouble(fields.getOrDefault("intensity", "1"));
        double duration = Double.parseDouble(fields.getOrDefault("durationMs", "5000"));
        if (!Double.isFinite(intensity) || intensity < 0 || intensity > 1
                || !Double.isFinite(duration) || duration < 0 || duration > 15000) throw new IllegalArgumentException("Out of range");
        return kind.equals("clear") ? Stimulus.clear() : new Stimulus(kind, intensity, duration);
    }

    private static void reply(HttpExchange exchange, int status, String body) throws IOException {
        reply(exchange, status, body.getBytes(StandardCharsets.UTF_8));
    }

    private static void reply(HttpExchange exchange, int status, byte[] body) throws IOException {
        exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
        exchange.getResponseHeaders().set("Cache-Control", "no-store");
        exchange.getResponseHeaders().set("X-Content-Type-Options", "nosniff");
        exchange.sendResponseHeaders(status, body.length);
        exchange.getResponseBody().write(body);
    }

    @Override public void close() {
        running = false;
        brainThread.interrupt();
        server.stop(0);
        httpExecutor.shutdownNow();
    }
}
