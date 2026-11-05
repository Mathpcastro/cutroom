/** Tools for producing videos from scratch (narration, music, brand, formats). Shared by the in-app agents and the external MCP server. */
const objectSchema = (
  properties: Record<string, unknown> = {},
  required: string[] = [],
) => ({ type: "object", properties, required, additionalProperties: false });

const number = (description: string, extra: Record<string, unknown> = {}) => ({
  type: "number",
  description,
  ...extra,
});
const string = (description: string, extra: Record<string, unknown> = {}) => ({
  type: "string",
  description,
  ...extra,
});

export const STUDIO_TOOLS = [
  {
    name: "add_audio",
    description:
      "Add a narration, music or sound-effect track from a local audio file (mp3, wav, m4a, aac, ogg, opus, flac). start is TIMELINE seconds. Music loops and ducks under speech by default when loop:true/duck omitted. Tracks keep their timeline position when the video is cut. Edit later with edit_project audio{id,...} or delete_audio{id}.",
    inputSchema: objectSchema(
      {
        path: string("Absolute path of the audio file."),
        kind: { type: "string", enum: ["voice", "music", "sfx"] },
        name: string("Label shown in the timeline."),
        start: number("Timeline second where it starts.", { minimum: 0 }),
        offset: number("Second inside the file where playback starts.", { minimum: 0 }),
        duration: number("Seconds to play. Default: rest of the file, or rest of the timeline when loop is true.", { minimum: 0.01 }),
        gain: number("Volume change in dB (-60 to 20). Music under narration usually -14 to -18.", { minimum: -60, maximum: 20 }),
        fadeIn: number("Fade-in seconds.", { minimum: 0 }),
        fadeOut: number("Fade-out seconds.", { minimum: 0 }),
        loop: { type: "boolean" },
        duck: { type: "boolean", description: "Music only: lower it while speech plays (default true)." },
      },
      ["path", "kind"],
    ),
  },
  {
    name: "list_voices",
    description:
      "List narration voices for a provider: elevenlabs (user's API key, word timing included), openai (user's API key; timing aligned locally, needs Transcrição local) or local (the computer's own voices: Windows SAPI with exact word timing, macOS say; free, offline, lower quality). Reports which providers are configured. Keys are entered by the user in CutRoom; never ask for them in chat.",
    inputSchema: objectSchema({
      provider: { type: "string", enum: ["elevenlabs", "openai", "local"] },
    }),
  },
  {
    name: "add_voiceover",
    description:
      "Synthesize narration from a script and add it as a voice track with word timings (captions follow it automatically). Write the script exactly as it must be spoken, in the user's language, short sentences. Returns the track id, its duration and the word timings in TIMELINE seconds: use them to place scenes on the exact word. Costs the user's provider credits: generate once, then reuse.",
    inputSchema: objectSchema(
      {
        text: string("Script to speak (max 5000 characters).", { maxLength: 5000 }),
        provider: { type: "string", enum: ["elevenlabs", "openai", "local"] },
        voice: string("Voice id from list_voices. Default: the voice chosen in CutRoom."),
        model: string("Provider model (optional)."),
        instructions: string("OpenAI only: tone/pace instructions, e.g. 'animado, ritmo rápido'."),
        start: number("Timeline second where the narration starts (default 0).", { minimum: 0 }),
        gain: number("Volume change in dB.", { minimum: -60, maximum: 20 }),
        name: string("Track label."),
      },
      ["text"],
    ),
  },
  {
    name: "search_music",
    description:
      "Search free music (Jamendo) and sound effects (Freesound) through Openverse, no key. Only licenses that allow commercial use are returned: CC0, public domain and CC BY. CC BY needs credit: the result's attribution text must go in the post caption (CutRoom stores it with the track and review_video lists it). Returns id, title, creator, license, attribution, duration (s) and a preview URL. Pick by mood, then add_music.",
    inputSchema: objectSchema(
      {
        query: string("Keywords, e.g. 'upbeat electronic', 'lofi', 'cinematic', 'whoosh'."),
        kind: { type: "string", enum: ["music", "sfx"] },
        limit: number("Max results (default 10).", { minimum: 1, maximum: 30 }),
      },
      ["query"],
    ),
  },
  {
    name: "add_music",
    description:
      "Download a search_music result (by id) into the project cache and add it as a music or sfx track. Same placement options as add_audio. The license and source are stored with the track.",
    inputSchema: objectSchema(
      {
        id: string("Result id from search_music."),
        kind: { type: "string", enum: ["music", "sfx"] },
        start: number("Timeline second.", { minimum: 0 }),
        offset: number("Second inside the file.", { minimum: 0 }),
        duration: number("Seconds to play.", { minimum: 0.01 }),
        gain: number("dB, default -16 for music.", { minimum: -60, maximum: 20 }),
        fadeIn: number("Seconds.", { minimum: 0 }),
        fadeOut: number("Seconds.", { minimum: 0 }),
        loop: { type: "boolean" },
      },
      ["id"],
    ),
  },
  {
    name: "get_brand",
    description:
      "Read the user's brand: business, product, audience, tone, offer, colors, fonts, logo (data URL) and links. Use it for every script, scene and caption so videos look and sound like the user's brand. Returns configured:false when the user has not set it up.",
    inputSchema: objectSchema(),
  },
  {
    name: "list_formats",
    description:
      "List the video formats CutRoom produces (explainer with a cartoon teacher, UI motion reel, 2D what-if cartoon, Kurzgesagt-style explainer...). Each has an id, aspect, length and what it is good for.",
    inputSchema: objectSchema(),
  },
  {
    name: "get_format_guide",
    description:
      "Read the full production guide of a format: script rules, pacing, scene structure, the reusable scene kit (HTML/SVG snippets and tween patterns), audio recipe and the quality checklist. Follow it step by step; it replaces generic advice.",
    inputSchema: objectSchema({ id: string("Format id from list_formats.") }, ["id"]),
  },
  {
    name: "render_frame",
    description:
      "Render the composed output frame at a TIMELINE second (video, scenes, captions) as an image, exactly as the export will look. Use it to check layout, text fit and timing before exporting. The first call after a change renders the whole video in the background (minutes for a 60 s reel): if it answers status 'rendering', call it again in 30–60 s without editing the project meanwhile; later calls are instant.",
    inputSchema: objectSchema({ time: number("Timeline second.", { minimum: 0 }) }, ["time"]),
  },
  {
    name: "job_status",
    description:
      "Status of the editor's recent jobs (export, preview render, narration, downloads): kind, label, progress %, status and output (the MP4 path when an export completed). Use it after export_video or render_frame answered that work is still running.",
    inputSchema: objectSchema(),
  },
  {
    name: "review_video",
    description:
      "Self-review before delivering: returns rendered frames at key moments, the narration words with timings, scene list and the format checklist. Score each checklist row honestly and fix weak rows before exporting.",
    inputSchema: objectSchema({
      format: string("Format id, to include its checklist."),
      frames: number("How many frames (default 6).", { minimum: 1, maximum: 12 }),
    }),
  },
];
