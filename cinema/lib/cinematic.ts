import type { BrainSnapshot } from "./types";

export type CinematicDrive = "feed" | "escape" | "groom" | "flight" | "explore" | "rest";
export interface CinematicDirection {
  prompt: string;
  caption: string;
  drive: CinematicDrive;
  reason: string;
  translator: "deterministic" | "llm";
  source: BrainSnapshot["source"];
  evidence: string[];
  sensoryTheme?: "odor" | "bitter";
  warning?: string;
}

export const CINEMATIC_STYLE = "Continuous subjective macro cinema at fruit-fly scale, tactile photoreal surfaces becoming exquisite organic surrealism. Amber, oxblood and ultraviolet iridescence against deep black; shallow depth of field, volumetric light, delicate 35mm film grain. One coherent moving shot, no cuts, no text, no diagrams, no humans. Wordless sound: close wing vibration, granular textures and a deep evolving ambient tone. No speech, narration or lyrics.";

const scenes: Record<CinematicDrive, { caption: string; opening: string; changes: string[] }> = {
  feed: {
    caption: "A universe made of sweetness.",
    opening: "At the surface of a split overripe cherry, a translucent bead of nectar towers like a molten amber planet. Drift toward its skin; scarlet fruit cells glow like windows in an immense living cathedral.",
    changes: ["The nectar sphere fills the horizon; golden surface tension bends reflected red fruit into slow liquid arches.", "Pass beneath a translucent ridge of fruit flesh as a tiny sugar crystal becomes a towering amber prism.", "Follow a glistening channel into the fruit; luminous droplets travel along red cellular walls like slow constellations."],
  },
  escape: {
    caption: "The sky is getting closer.",
    opening: "A tiny amber world beneath a leaf is swallowed by an enormous moving shadow. The overhead shape expands across the entire sky; bank hard and dive through a narrow forest of backlit hairs into a sliver of violet light.",
    changes: ["An immense shadow sweeps across the red landscape; the viewpoint turns sharply and skims beneath a translucent leaf vein.", "The dark canopy descends; accelerate through a luminous gap between towering hairs, the shadow falling behind.", "A rushing wall of darkness crosses the horizon; veer into a crevice of iridescent leaf tissue, fine dust trailing in the air."],
  },
  groom: {
    caption: "Making the world clear again.",
    opening: "Fine dust hangs between a forest of sensory hairs, each particle a small illuminated moon. Two delicate translucent insect forelegs sweep slowly through the foreground, freeing the air into an extraordinary field of sharp amber light.",
    changes: ["A delicate segmented foreleg passes across the foreground; clinging golden particles peel away and drift into black space.", "Glide along a ridge of fine sensory hairs as an iridescent film parts and droplets tumble free.", "A last veil of dust breaks into thousands of sparkling grains, revealing the luminous red cellular landscape beyond."],
  },
  flight: {
    caption: "The ground becomes a galaxy.",
    opening: "Lift from the skin of a cherry into a vast ultraviolet garden. The ground falls away into a tessellated red planet; transparent wings flicker only at the frame edges as luminous pollen passes like a meteor field.",
    changes: ["Climb between immense translucent leaves; their veins spread below like amber river deltas.", "Bank around a suspended nectar droplet, its curved reflection wrapping the entire violet garden around the viewpoint.", "Accelerate over a velvet red fruit horizon, pollen grains streaming past toward a distant golden opening."],
  },
  explore: {
    caption: "Everything is enormous. Everything is near.",
    opening: "Move at fruit-fly eye height across the velvet skin of a red cherry. Fine hairs rise like impossibly tall reeds; a bead of condensation contains an inverted violet universe. Slowly circle it, discovering a warm amber passage beyond.",
    changes: ["Drift between towering red hairs toward a luminous bead of condensation; its reflection opens an inverted garden.", "Turn along a translucent leaf vein; warm gold light moves beneath the cellular surface like a slow river.", "Cross a ridge of velvet fruit toward a violet opening, delicate grains of pollen suspended motionless overhead."],
  },
  rest: {
    caption: "A small stillness, inside an enormous world.",
    opening: "An almost motionless insect-scale view beneath a translucent leaf. A single amber droplet rests on a dark red surface; quiet light breathes through its curved reflection while distant pollen drifts across a violet-black void.",
    changes: ["Hold near the amber droplet as one illuminated pollen grain travels slowly through its reflection.", "Barely drift along the dark velvet surface; an immense soft leaf shadow passes far above.", "The curved droplet reflects a violet garden, tiny changes in light rippling across its otherwise still surface."],
  },
};

const finite = (value: number) => Number.isFinite(value) ? value : 0;

/** A declared artistic mapping from measurements, never a decoder of subjective experience. */
export function interpretBrain(snapshot: BrainSnapshot, opening = false, sceneIndex?: number): CinematicDirection {
  const motors = snapshot.motors;
  const ranked: [CinematicDrive, number][] = [
    ["escape", Math.max(0, finite(motors.escape))],
    ["feed", Math.max(0, finite(motors.feed))],
    ["groom", Math.max(0, finite(motors.groom))],
    ["flight", Math.max(0, finite(motors.flight))],
    ["explore", Math.max(Math.abs(finite(motors.forward)), Math.abs(finite(motors.yaw)) * 0.45)],
  ];
  ranked.sort((a, b) => b[1] - a[1]);
  const drive: CinematicDrive = ranked[0][1] > 0.08 ? ranked[0][0] : "rest";
  const strongest = [...snapshot.populations].filter(p => p.count > 0 && Number.isFinite(p.hz)).sort((a, b) => b.hz - a.hz).slice(0, 3);
  const evidence = strongest.map(p => `${p.name}: ${p.hz.toFixed(1)} Hz across ${p.count} modeled neurons`);
  evidence.unshift(drive === "rest" ? "All weighted motor display scores are at or below 0.08 (yaw contributes at 0.45×)" : `${drive} readout: ${ranked[0][1].toFixed(3)} (model units)`);
  if (snapshot.stimulus.kind === "bitter") evidence.push(`Bitter input is applied; feed readout is ${finite(motors.feed).toFixed(3)}. Without a baseline comparison this does not establish suppression or negative valence.`);
  const scene = scenes[drive];
  const beat = sceneIndex === undefined
    ? Math.floor(Math.max(0, finite(snapshot.simulatedMs)) / 2_000) % scene.changes.length
    : Math.floor(Math.max(0, finite(sceneIndex))) % scene.changes.length;
  const rate = (name: string) => snapshot.populations.find(p => p.name === name && p.count > 0)?.hz ?? 0;
  const odorHz = finite(rate("ORN_DM1"));
  const bitterHz = finite(rate("Bitter GRNs"));
  // A visible scent field and violet crystallization are declared metaphors for
  // sensory activity. They do not require, or imply, hunger, aversion or suppression.
  const sensoryTheme = Math.max(odorHz, bitterHz) > 10 ? (odorHz > bitterHz ? "odor" : "bitter") : undefined;
  let visual = opening ? scene.opening : scene.changes[beat];
  let caption = scene.caption;
  if (sensoryTheme === "odor") {
    visual += " A fine luminous scent-field becomes visible as amber ribbons suspended between the leaf hairs, a quiet river of light winding into violet distance.";
    evidence.push(`ORN_DM1 sensory population: ${odorHz.toFixed(1)} Hz. Visible scent ribbons are an artistic convention, not a measured percept.`);
    if (drive === "rest" || drive === "explore") caption = "An invisible river, made of light.";
  } else if (sensoryTheme === "bitter") {
    visual += " The red cellular surface develops angular violet reflections like a landscape seen through a slowly turning dark crystal; the ongoing motion remains unchanged.";
    evidence.push(`Bitter GRNs sensory population: ${bitterHz.toFixed(1)} Hz. Violet crystal imagery does not establish behavioral rejection or subjective dislike.`);
    if (drive === "rest" || drive === "explore") caption = "The world takes on another shape.";
  }
  return {
    prompt: `${visual} ${CINEMATIC_STYLE}`,
    caption,
    drive,
    reason: `${snapshot.source === "preview" ? "Synthetic preview" : "Connectome simulation"}; ${evidence[0]}. Scene scale and symbolism are artistic choices.`,
    translator: "deterministic",
    source: snapshot.source,
    evidence,
    ...(sensoryTheme ? { sensoryTheme } : {}),
  };
}

export const DIRECTOR_SYSTEM_PROMPT = `You are the cinematographer of A LITTLE MIND, a fruit-fly connectome simulation translated into continuous surreal macro cinema. We do not read a living fly's thoughts. The biological basis is measured activity in a computational model; the visual metaphors are authored interpretation.
Return only JSON: {"prompt": string, "caption": string, "drive": string, "reason": string}.
The supplied DRIVE and EVIDENCE are authoritative and immutable. Match drive exactly. Do not invent firing rates, sensations, memories, emotions, neuron functions, consciousness, inner speech, or a measured biological fact. A stimulus label is an experimental input, not proof that a corresponding response occurred. Preview source is synthetic and must never be represented as connectome evidence.
When SENSORY THEME is supplied, incorporate that visual convention based on the measured sensory population, without inventing a motor action or emotion: odor becomes a luminous ribbon field; bitter becomes violet crystalline reflections. These metaphors can transform the scenery while preserving the measured motor drive. If no theme is supplied, do not infer it from the experimental-input label.
Prompt: 2–3 concrete sentences, 350–750 characters before the supplied style suffix. Continue the previous shot through ONE beautifully readable development that expresses the measured drive. Work at fly scale: nectar planets, cathedral-sized sensory hairs, fruit-cell architecture, a looming shadow that devours the sky, ultraviolet leaf rivers, pollen meteor fields. Make images immediate, tactile, strange and elegant. Avoid random scene switching and repeat imagery only to develop it. For REST, preserve quiet and nearly still motion; never add a dramatic escape because a threat stimulus exists if escape activity is absent.
Caption: 3–10 words, poetic scene description, not a statement spoken or thought by a fly. No first-person sentences, no quotation marks, no claims of fear, hunger, desire or memories. It is an artistic subtitle. Reason: one short sentence linking the exact supplied evidence to the cinematic choice; do not add measurements.
Never include speech, words in the image, human characters, human anatomy, violence or human stories. No camera equipment in the scene. An insect-scale first-person visual convention is allowed but is not a claim to reproduce compound-eye perception. The style suffix will be attached by the application, so do not repeat it.`;
