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
  responseKey?: string;
}

export const INITIALIZATIONS = [
  { id: 'garden', label: 'Garden absurdity', description: 'A moist medium-brown dog turd, two or three thick sausage-like coils with a tapered end, on a paving stone. Full recognizable silhouette, not a pellet or rock. Film it with ridiculous grandeur.' },
  { id: 'sugar', label: 'Sugar cathedral', description: 'An enormous translucent sugar crystal on a kitchen counter.' },
  { id: 'fruit', label: 'Overripe orchard', description: 'A split overripe plum beneath leaves in a miniature garden.' },
] as const;
export type Initialization = typeof INITIALIZATIONS[number]['id'];
export function isInitialization(value: unknown): value is Initialization {
  return INITIALIZATIONS.some(item => item.id === value);
}
export function sceneStyle(initialization: Initialization = 'garden') {
  return `Authored setting: ${INITIALIZATIONS.find(item => item.id === initialization)!.description} ${CINEMATIC_STYLE}`;
}
function setScene(visual: string, initialization: Initialization) {
  if (initialization === 'garden') return visual;
  return visual.replace(/(?:small, unmistakable |small |little |tiny, unmistakable |tiny |ordinary |familiar )?(?:brown animal dropping|animal dropping|dropping|poop)/gi,
    initialization === 'sugar' ? 'translucent angular sugar crystal' : 'split overripe plum')
    .replace(/garden paving stone|paving.stone|stone ridge|stone seams/gi, initialization === 'sugar' ? 'kitchen countertop' : 'garden leaf');
}

export const CINEMATIC_STYLE = "Continuous photoreal macro cinema at insect eye height, maintaining the chosen subject and location. Frame the WHOLE recognizable subject in the opening, with enough depth of field to read its silhouette. Rich warm side-light, visible natural colors, not a dark granular ball. No insect bodies or legs in view except brief foreleg sweeps when grooming is measured. Exaggerated nature-documentary grandeur and insect foley, deadpan visual comedy. Environmental animation continues throughout: moving grass shadows, drifting pollen, shifting sunlight. Environmental motion is artistic, not a motor readout. No speech, narration or lyrics. No text, humans, cartoon faces or injury.";

const scenes: Record<CinematicDrive, { caption: string; opening: string; changes: string[] }> = {
  feed: {
    caption: "A significant discovery.",
    opening: "A small brown animal dropping sits on a garden paving stone. Approach it at insect eye height with the reverence of a billion-dollar archaeological discovery; its ridiculous silhouette fills the frame in glorious golden backlight. The subject must remain clearly recognizable as ordinary poop.",
    changes: ["Continue the measured feeding approach toward the same small poop. Its crumbly surface fills the view like an unnecessarily majestic mountain; hold the golden reveal.", "Move a little closer to the same dropping, keeping its recognizable shape in view. A solemn shaft of evening light makes this extremely ordinary discovery look priceless.", "Resume a slow, reverent approach to the same poop on the same paving stone. Repeat the grand reveal with complete cinematic sincerity."],
  },
  escape: {
    caption: "The situation has changed.",
    opening: "The same little poop sits on a garden paving stone. An enormous rolled newspaper suddenly casts a shadow overhead; the viewpoint retreats sharply away from both, making the once-majestic dropping recede. No impact or injury.",
    changes: ["Retreat from the same poop as a huge newspaper shadow crosses the paving stone. Keep the object visible in the distance; the solemn discovery has become an undignified withdrawal.", "Continue withdrawing beneath a stone ridge as the overhead newspaper passes. No collision; the familiar dropping remains far away.", "Bank away from the broad overhead shadow, putting more paving stone between the viewpoint and the same small poop. Preserve the location."],
  },
  groom: {
    caption: "Routine maintenance.",
    opening: "Keep the subject in view in front of the same small poop on the paving stone. Two tiny articulated insect forelegs sweep the immediate foreground in quick, distinct alternating strokes like very earnest windshield wipers, clearing a few dust specks. The grandly lit object waits unchanged behind them.",
    changes: ["Tiny forelegs make three quick, distinct cleaning strokes, then briefly clear the foreground. Keep the same poop in the background.", "A little foreleg removes one stubborn speck from the foreground with disproportionate care. Keep the whole subject recognizable.", "Complete another delicate grooming sweep; the foreground clears to reveal the same absurdly majestic poop, with a clear change from obscured to unobstructed view."],
  },
  flight: {
    caption: "An aerial survey.",
    opening: "Lift above the garden paving stone at insect scale. The same tiny poop becomes the centerpiece of an extravagantly cinematic aerial survey, warm light tracing its ordinary silhouette.",
    changes: ["Climb gently above the same dropping, revealing the paving-stone seams around it like a vast landscape.", "Bank above the same patch of paving stone, keeping the small poop as the recognizable landmark below.", "Continue a low aerial pass over the same dropping and stone. No new location or object."],
  },
  explore: {
    caption: "A promising lead.",
    opening: "Explore slowly across a garden paving stone at insect eye height. A tiny, unmistakable poop emerges beyond a ridge of grit, revealed with the solemn grandeur normally reserved for ancient monuments.",
    changes: ["Move laterally past grains of grit, revealing another side of the same small poop in golden evening light. Survey rather than feed.", "Explore the paving stone around the same dropping, keeping its silhouette recognizable as the foreground shifts.", "Round a low stone ridge and rediscover the same ordinary poop with an unnecessarily magnificent reveal."],
  },
  rest: {
    caption: "No further developments.",
    opening: "An insect-height establishing view of one small, unmistakable poop on a garden paving stone. It receives absurdly beautiful golden rim lighting. Wind moves grass shadows across the subject and pollen drifts past; use a gentle focus change for a clear reveal. Camera translation remains still because no motor response was measured.",
    changes: ["Wind ripples grass shadows across the same subject; shift focus from foreground grit to its full recognizable shape. No camera travel or motor action.", "Hold camera position while moving evening light reveals the full subject and airborne pollen crosses the view. Environmental animation only.", "Keep camera position; a soft breeze moves nearby grass and its shadows over the subject. No approach, threat, flight or cleaning."],
  },
};

const finite = (value: number) => Number.isFinite(value) ? value : 0;

/** A declared artistic mapping from measurements, never a decoder of subjective experience. */
export function interpretBrain(snapshot: BrainSnapshot, opening = false, sceneIndex?: number, initialization: Initialization = 'garden'): CinematicDirection {
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
    visual += " Faint amber scent wisps hang above the same dropping as an authored odor metaphor. Preserve the existing camera behavior; sensory activity alone must not cause approach.";
    evidence.push(`ORN_DM1 sensory population: ${odorHz.toFixed(1)} Hz. Visible scent ribbons are an artistic convention, not a measured percept.`);
    if (drive === "rest" || drive === "explore") caption = "An atmospheric development.";
  } else if (sensoryTheme === "bitter") {
    visual += " Subtle violet reflections appear on the paving stone as an authored bitter-sensory metaphor; the object and ongoing motion remain unchanged.";
    evidence.push(`Bitter GRNs sensory population: ${bitterHz.toFixed(1)} Hz. Violet crystal imagery does not establish behavioral rejection or subjective dislike.`);
    if (drive === "rest" || drive === "explore") caption = "Conditions under observation.";
  }
  // Preserve secondary measured responses instead of discarding everything except
  // the largest score. Escape keeps priority over an incompatible feeding approach.
  const secondaryFeed = drive !== 'feed' && drive !== 'escape' && finite(motors.feed) > 0.08;
  if (secondaryFeed) {
    visual += " A concurrent measured feeding response adds a short, deliberate forward approach between the primary action's beats.";
    evidence.push(`Concurrent feed readout: ${finite(motors.feed).toFixed(3)} (model units); adds approach without replacing the dominant drive.`);
  }
  const sugar = finite(rate('Sugar GRNs')) > 10;
  const looming = Math.max(finite(rate('LC4')), finite(rate('LPLC2'))) > 10;
  const touch = Math.max(finite(rate('aDN1')), finite(rate('aDN2'))) > 10;
  if (sugar) visual += " Measured sugar sensory activity is represented by sparkling warm highlights revealing the subject's surface; this alone does not cause approach.";
  if (looming) visual += " Measured looming-sensitive population activity introduces a broad passing overhead shadow; retreat only if the motor direction calls for it.";
  if (touch) visual += " Measured touch-associated population activity adds a brief dust disturbance in the foreground; preserve the motor direction.";
  if (sugar) evidence.push(`Sugar GRNs: ${rate('Sugar GRNs').toFixed(1)} Hz; highlights are an authored sensory cue.`);
  if (looming) evidence.push(`LC4: ${rate('LC4').toFixed(1)} Hz; LPLC2: ${rate('LPLC2').toFixed(1)} Hz; shadow is an authored sensory cue.`);
  if (touch) evidence.push(`aDN1: ${rate('aDN1').toFixed(1)} Hz; aDN2: ${rate('aDN2').toFixed(1)} Hz; dust is an authored cue, not a decoded percept.`);
  return {
    responseKey: [secondaryFeed, sugar, looming, touch].map(Number).join(''),
    prompt: `${setScene(visual, initialization)} ${sceneStyle(initialization)}`,
    caption,
    drive,
    reason: `${snapshot.source === "preview" ? "Synthetic preview" : "Connectome simulation"}; ${evidence[0]}. Scene scale and symbolism are artistic choices.`,
    translator: "deterministic",
    source: snapshot.source,
    evidence,
    ...(sensoryTheme ? { sensoryTheme } : {}),
  };
}

export const DIRECTOR_SYSTEM_PROMPT = `You are the cinematographer of A LITTLE MIND, a fruit-fly connectome simulation translated into deadpan cinematic macro comedy. We do not read a living fly's thoughts. The biological basis is measured activity in a computational model; the visual metaphors are authored interpretation.
Return only JSON: {"prompt": string, "caption": string, "drive": string, "reason": string}.
The supplied DRIVE and EVIDENCE are authoritative and immutable. Match drive exactly. Do not invent firing rates, sensations, memories, emotions, neuron functions, consciousness, inner speech, or a measured biological fact. A stimulus label is an experimental input, not proof that a corresponding response occurred. Preview source is synthetic and must never be represented as connectome evidence.
When SENSORY THEME is supplied, incorporate that visual convention based on the measured sensory population, without inventing a motor action or emotion: odor becomes faint amber wisps above the same dropping; bitter becomes violet reflections on the paving stone. These metaphors can transform the scenery while preserving the measured motor drive. If no theme is supplied, do not infer it from the experimental-input label.
Prompt: 2–3 concrete sentences, 350–750 characters before the supplied style suffix. Continue the previous shot through ONE beautifully readable development that expresses the measured drive. Preserve the exact authored subject and setting in the suggested scene. The joke is extravagant, completely serious cinematography of the chosen mundane object. Feeding means approach; escape means retreat beneath a newspaper shadow without impact; grooming means stationary foreleg cleaning; exploration means surveying; flight means lifting. Do not invent actions for comic timing. Never replace the chosen subject or disregard the supplied secondary-response cues. For REST, keep the camera in place but animate environmental light, grass shadows and pollen; never add a dramatic escape because a threat stimulus exists if escape activity is absent.
Caption: 3–10 words, poetic scene description, not a statement spoken or thought by a fly. No first-person sentences, no quotation marks, no claims of fear, hunger, desire or memories. It is an artistic subtitle. Reason: one short sentence linking the exact supplied evidence to the cinematic choice; do not add measurements.
Never include speech, words in the image, human characters, human anatomy, violence or human stories. No camera equipment in the scene. An insect-scale first-person visual convention is allowed but is not a claim to reproduce compound-eye perception. The style suffix will be attached by the application, so do not repeat it.`;
