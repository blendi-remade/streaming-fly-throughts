package com.fruitfly.brain;

import com.fruitfly.brain.tools.CinemaBridge;
import org.junit.jupiter.api.Test;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.function.Predicate;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.*;

/** Validates the external boundary, including malformed bodies that must never drive the neural worker. */
class CinemaBridgeTest {
    @Test void explicitResetClearsNeuralAndMotorStateAndOrdersTheNextStimulus() throws Exception {
        SyntheticConnectome builder = new SyntheticConnectome();
        int sensor = builder.neuron("LB3b", 1, "L");
        int motor = builder.neuron("MN9", 1, "L");
        builder.edge(sensor, motor, 40);
        Connectome c = builder.build();
        c.classes[0] = "gustatory";
        LifConfig config = new LifConfig();
        config.dtMs = 0.5;
        config.synTauMs = 0;
        config.gain = 1;
        config.threads = 1;
        try (CinemaBridge bridge = new CinemaBridge(c, config, 0); HttpClient client = HttpClient.newHttpClient()) {
            bridge.start();
            String base = "http://127.0.0.1:" + bridge.port();
            assertEquals(202, post(client, base + "/stimulus", "{\"kind\":\"sugar\",\"durationMs\":15000}"));
            String active = awaitState(client, base, json -> number(json, "feed") > 0 && number(json, "simulatedMs") >= 200);
            assertTrue(number(active, "cumulativeSpikes") > 0, "the synthetic sensory-to-motor circuit must actually fire");
            assertEquals(202, post(client, base + "/reset", "{}"));
            String reset = awaitState(client, base, json -> number(json, "trial") == 1);
            assertTrue(number(reset, "sequence") > number(active, "sequence"), "transport sequence must remain monotonic");
            assertTrue(number(reset, "simulatedMs") < number(active, "simulatedMs"), "a new trial restarts neural time");
            assertEquals(0, number(reset, "cumulativeSpikes"));
            assertEquals(0, number(reset, "feed"), "motor decoder smoothing must reset with the network");
            assertTrue(reset.contains("\"kind\":\"clear\""));
            assertTrue(number(reset, "resetAt") > 0);

            assertEquals(400, post(client, base + "/reset", "{\"kind\":\"sugar\"}"));
            assertEquals(202, post(client, base + "/reset", "{}"));
            assertEquals(202, post(client, base + "/stimulus", "{\"kind\":\"sugar\",\"durationMs\":15000}"));
            String next = awaitState(client, base, json -> number(json, "trial") == 2 && number(json, "feed") > 0);
            assertTrue(next.contains("\"kind\":\"sugar\""), "reset must not discard a stimulus accepted after it");
        }
    }

    private static int post(HttpClient client, String url, String body) throws Exception {
        return client.send(HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(3))
                .header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString(body)).build(),
                HttpResponse.BodyHandlers.ofString()).statusCode();
    }

    private static String awaitState(HttpClient client, String base, Predicate<String> condition) throws Exception {
        long deadline = System.nanoTime() + Duration.ofSeconds(4).toNanos();
        String latest = "";
        while (System.nanoTime() < deadline) {
            var response = client.send(HttpRequest.newBuilder(URI.create(base + "/state"))
                    .timeout(Duration.ofSeconds(3)).GET().build(), HttpResponse.BodyHandlers.ofString());
            assertEquals(200, response.statusCode());
            latest = response.body();
            if (condition.test(latest)) return latest;
            Thread.sleep(10);
        }
        fail("Expected bridge state was not observed: " + latest);
        return latest;
    }

    private static double number(String json, String field) {
        var matcher = Pattern.compile("\"" + Pattern.quote(field) + "\":([-+0-9.eE]+)").matcher(json);
        assertTrue(matcher.find(), "Missing numeric field " + field);
        return Double.parseDouble(matcher.group(1));
    }

    @Test void acceptsReorderedFieldsAndBoundaries() {
        var s = CinemaBridge.parseStimulus(" { \"durationMs\" : 15000, \"intensity\" : 1e0, \"kind\" : \"sugar\" } ");
        assertEquals("sugar", s.kind());
        assertEquals(1, s.intensity());
        assertEquals(15000, s.durationMs());
        assertEquals(0, CinemaBridge.parseStimulus("{\"kind\":\"bitter\",\"intensity\":0,\"durationMs\":0}").durationMs());
    }

    @Test void clearAlwaysRemovesTheDrive() {
        var s = CinemaBridge.parseStimulus("{\"kind\":\"clear\",\"intensity\":1,\"durationMs\":1000}");
        assertEquals("clear", s.kind());
        assertEquals(0, s.intensity());
        assertEquals(0, s.durationMs());
    }

    @Test void rejectsInvalidAndAmbiguousPayloads() {
        String[] invalid = {
                "{}", "null", "[]", "{\"kind\":sugar}", "{\"kind\":\"brain\"}",
                "{\"kind\":\"sugar\",}", "{\"kind\":\"sugar\", \t}",
                "{\"kind\":\"sugar\",\"kind\":\"bitter\"}",
                "{\"kind\":\"sugar\",\"extra\":1}",
                "{\"kind\":\"sugar\",\"intensity\":-0.01}",
                "{\"kind\":\"sugar\",\"intensity\":1.01}",
                "{\"kind\":\"sugar\",\"intensity\":1e999}",
                "{\"kind\":\"sugar\",\"durationMs\":15001}",
                "{\"kind\":\"sugar\",\"durationMs\":-1}",
                "{\"kind\":\"sugar\",\"durationMs\":\"sugar\"}",
                "{\"kind\":\"sugar\"} trailing", "{\"kind\":\"sugar\",\"intensity\":01}"
        };
        for (String body : invalid) assertThrows(IllegalArgumentException.class, () -> CinemaBridge.parseStimulus(body), body);
    }
}
