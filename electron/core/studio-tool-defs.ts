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
const avatarReference = objectSchema(
  {
    avatarId: string("Avatar id returned by the avatar tools."),
    revision: number("Approved immutable avatar revision.", { minimum: 1 }),
    hash: string("SHA-256 hash of the approved revision.", { pattern: "^[a-f0-9]{64}$" }),
  },
  ["avatarId", "revision", "hash"],
);

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
      "List narration voices for a provider: elevenlabs (user's API key, word timing included), openai (user's API key; timing aligned locally, needs Transcrição local), kokoro (package Voz Kokoro: natural offline voices on the user's CPU, free, pt-BR pm_alex default / pf_dora / pm_santa, also English and Spanish; ~2x real time, timing aligned locally) or local (the computer's own voices: Windows SAPI with exact word timing, macOS say; free, offline, robotic). Without a provider, the default is the user's choice, else ElevenLabs if configured, else Kokoro if installed. Reports which providers are configured. Keys are entered by the user in CutRoom; never ask for them in chat.",
    inputSchema: objectSchema({
      provider: { type: "string", enum: ["elevenlabs", "openai", "kokoro", "local"] },
    }),
  },
  {
    name: "add_voiceover",
    description:
      "Synthesize narration from a script and add it as a voice track with word timings (captions follow it automatically). Write the script exactly as it must be spoken, in the user's language, short sentences. Returns the track id, its duration and the word timings in TIMELINE seconds: use them to place scenes on the exact word. Costs the user's provider credits (kokoro and local are free): generate once, then reuse. If it answers status 'generating', call again with the same text in ~30 s.",
    inputSchema: objectSchema(
      {
        text: string("Script to speak (max 5000 characters).", { maxLength: 5000 }),
        provider: { type: "string", enum: ["elevenlabs", "openai", "kokoro", "local"] },
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
      "List the video formats CutRoom produces (explainer with a cartoon teacher, UI motion reel, 2D what-if cartoon, animated visual explainer without an avatar...). Each has an id, aspect, length and what it is good for.",
    inputSchema: objectSchema(),
  },
  {
    name: "get_format_guide",
    description:
      "Read the production guide and checklist for a format. Some presets provide visual direction only: take the subject, script, scenes and ending from the user brief.",
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
  // Films in code: full HyperFrames projects (HTML + GSAP) written by the agent, rendered by CutRoom.
  {
    name: "create_film",
    description:
      "Start a FILM IN CODE: the highest-quality way to make a reel (explainers, UI motion, product demos, cartoons). Creates a folder in Videos/CutRoom/filmes/<id>/ with index.html (starter), CUTROOM.md (contract, kit, quality rules and the format guide), the motion kit (kit/cutroom-kit.js, GSAP), fonts, brand.js (user's brand) and assets/. You write the film as HTML/CSS/JS with one paused GSAP timeline; CutRoom records the voice with word timings, checks, previews frames and renders the MP4. Edit the folder with your own file tools when you have them, otherwise write_film_file. Prefer this over the timeline scene tools for new videos.",
    inputSchema: objectSchema(
      {
        name: string("Film title (also the output file name)."),
        aspect: { type: "string", enum: ["9:16", "16:9", "1:1", "4:5"], description: "Default 9:16 (Reels), or the format's aspect." },
        format: string("Format id from list_formats: its guide and checklist are written into CUTROOM.md."),
        avatar: avatarReference,
      },
      ["name"],
    ),
  },
  {
    name: "update_film_avatar",
    description: "Explicitly replace one film's immutable avatar snapshot with another approved revision. Other films and older snapshots are unchanged.",
    inputSchema: objectSchema({ film: string("Film id."), avatar: avatarReference }, ["film", "avatar"]),
  },
  {
    name: "list_films",
    description: "List the user's films (id, name, size, folder, format), newest first.",
    inputSchema: objectSchema(),
  },
  {
    name: "film_voiceover",
    description:
      "Record the film's narration from the script and write timing.js: window.TIMING = {words:[{text,start,end}], envelope:{fps:30, db:[...]}, voiceEnd}. CR.word('palavra', n) then returns the second each word is spoken, CR.captions/CR.mouth use it automatically. Returns the words with times, the <audio> tag to put in index.html and the suggested film duration. Cached by script+voice: re-running the same script costs nothing; changing it costs the user's provider credits again (kokoro and local are free). If it answers status 'generating', call again with the same text in ~30 s.",
    inputSchema: objectSchema(
      {
        film: string("Film id."),
        text: string("Exact script to speak, user's language, short sentences (max 5000 chars).", { maxLength: 5000 }),
        provider: { type: "string", enum: ["elevenlabs", "openai", "kokoro", "local"] },
        voice: string("Voice id from list_voices. Default: the voice chosen in CutRoom."),
        model: string("Provider model (optional)."),
        instructions: string("OpenAI only: tone/pace instructions."),
        audio: string("Absolute path of a narration already recorded elsewhere (ElevenLabs, a cloned voice, a microphone). The voice is kept as is and the word timings come from the local transcription aligned to text (the exact script)."),
      },
      ["film", "text"],
    ),
  },
  {
    name: "film_asset",
    description:
      "Put media into the film's assets/ folder: music or a sound effect from search_music (music: id; license re-checked, CC BY credit recorded and returned), or a local file the user gave you (path: absolute; images, video or audio, e.g. product screenshots). Returns the relative path to use in index.html (src=\"assets/...\").",
    inputSchema: objectSchema(
      {
        film: string("Film id."),
        music: string("Track id from search_music."),
        path: string("Absolute path of a local image, video or audio file."),
        name: string("File name to use inside assets/ (optional)."),
      },
      ["film"],
    ),
  },
  {
    name: "write_film_file",
    description:
      "Write a text file inside the film folder (index.html, extra .css/.js/.svg/.json/.md). Paths are relative to the film folder; nothing outside it can be written. film.json and timing.js belong to CutRoom. Max 2 MB. No remote URLs: everything must be in the folder or a data: URL.",
    inputSchema: objectSchema(
      {
        film: string("Film id."),
        path: string("Relative path, e.g. index.html or scenes/demo.js."),
        content: string("Full file content."),
      },
      ["film", "path", "content"],
    ),
  },
  {
    name: "read_film_file",
    description: "Read a text file of the film (e.g. CUTROOM.md, index.html, timing.js). Without path, lists the film's files and its folder.",
    inputSchema: objectSchema({ film: string("Film id."), path: string("Relative path.") }, ["film"]),
  },
  {
    name: "film_capture_page",
    description:
      "Screenshot a public web page (the user's landing page, product page or app) at 1440 px wide, full height up to 9000 px, into the film's assets/ as JPEG. Input of the landing page fly-over format and of any scene that shows the user's real site. Returns the file, its size and the page title. The capture uses the internet; the film render never does.",
    inputSchema: objectSchema(
      { film: string("Film id."), url: string("http(s) link of the page."), name: string("File name inside assets/ (default pagina).") },
      ["film", "url"],
    ),
  },
  {
    name: "analyze_reference",
    description:
      "Read a reference video (a viral Reel, TikTok or post the user wants to recreate) and return its mold: duration, every cut, seconds per shot, words per second, energy (0–1), hook (first 3 s of speech), palette, and per scene: start, end, motion, colours and what is said; plus keyframes. Use it to recreate the SAME structure with the user's avatar, voice and product: keep the number of scenes, the hook pattern, the beat lengths and the rhythm; rewrite every line for the user's product; never copy the footage. Pass `style` to CRM.autoReel({ reference: style }) so cuts, colours and transition energy follow the reference. Input: an absolute file path, or a link to a post on X or a direct .mp4 (Instagram, TikTok and YouTube need the downloaded file).",
    inputSchema: objectSchema({ path: string("Absolute path of the reference video."), url: string("Link of a post on X or a direct .mp4.") }, []),
  },
  {
    name: "list_effects",
    description:
      "Search the effects catalogue that ships with the app (236 HyperFrames components, offline): kinetic captions, text reveals, transitions and wipes, light/grain/VFX overlays, cursors and UI motion, notifications, counters, charts, CTAs, logo stings. Returns name, title, description and tags. Then film_add_effect puts one in a film.",
    inputSchema: objectSchema({ query: string("Words to search, e.g. 'caption karaoke', 'transition light', 'cursor click', 'notification'."), limit: { type: "number", description: "Max results (default 40)." } }, []),
  },
  {
    name: "film_add_effect",
    description:
      "Copy one effect from list_effects into the film (compositions/components/) and get its mount snippet and variables. Mount it in index.html as a .clip div with id, data-start, data-duration, data-track-index and data-variable-values; size the div where the effect should appear. Use cues from the narration word times.",
    inputSchema: objectSchema({ film: string("Film id."), name: string("Effect name from list_effects.") }, ["film", "name"]),
  },
  {
    name: "film_check",
    description:
      "Check the film before rendering: HyperFrames linter, missing files, remote URLs (refused: the render never uses the internet), timeline registration, non-deterministic code, narration tag. Returns errors (must fix) and warnings.",
    inputSchema: objectSchema({ film: string("Film id.") }, ["film"]),
  },
  {
    name: "film_stills",
    description:
      "Render exact frames of the film at chosen seconds (half resolution) plus any script errors. Use 4–6 times around key words (hook, demos, final question) to check layout, text size, overlaps and timing before render_film. Takes ~10–20 s.",
    inputSchema: objectSchema(
      { film: string("Film id."), times: { type: "array", items: { type: "number", minimum: 0 }, minItems: 1, maxItems: 8, description: "Seconds." } },
      ["film", "times"],
    ),
  },
  {
    name: "film_review",
    description:
      "Review 7 key frames, motion and narration metrics, inspection flags and the visual checklist before rendering. Compare them with the user brief. Keep deliberate choices such as a single shot or a long pause when they fit the request. Takes ~20–40 s.",
    inputSchema: objectSchema({ film: string("Film id.") }, ["film"]),
  },
  {
    name: "open_studio",
    description:
      "Open a screen of CutRoom's Estúdio de vídeos for the USER to fill in: brand (marca), voices (API keys, Kokoro install, default voice), publish (Composio key, Instagram account), films or start. Use it instead of asking for keys or long brand details in chat.",
    inputSchema: objectSchema({ tab: { type: "string", enum: ["start", "brand", "voices", "films", "publish"] } }, ["tab"]),
  },
  {
    name: "instagram_accounts",
    description: "Instagram accounts the user connected for Reels publishing (Composio, set up in CutRoom › Estúdio › Publicar), the default account and recent posts. Never ask for the Composio key in chat.",
    inputSchema: objectSchema(),
  },
  {
    name: "schedule_reel",
    description:
      "Schedule one MP4 from Videos/CutRoom to be published as a Reel at a local date and time (\"2026-11-08 18:00\"). The operating system opens CutRoom at that time and it posts by itself; if the computer was off it posts when it comes back (up to 6 h late, later it waits for the user). ONLY after the user confirmed video, caption, account and time — then confirm:true. instagram_accounts lists what is scheduled.",
    inputSchema: objectSchema(
      {
        video: string("Absolute path of the MP4."),
        caption: string("Caption (max 2200). End with the funnel CTA (link no perfil) and the CC BY credit when there is one.", { maxLength: 2200 }),
        at: string("Local date and time, YYYY-MM-DD HH:MM, at least 2 minutes ahead and up to 120 days."),
        account: string("Account id or @username (default: the user's default)."),
        confirm: { type: "boolean", enum: [true] },
      },
      ["video", "at", "confirm"],
    ),
  },
  {
    name: "schedule_reels_daily",
    description:
      "Reels autopilot: schedule a series in the given order, 1 to 5 posts per day (each at its own time, at least 1 h apart) on the chosen days. Each post keeps its own caption. Use it to keep a daily organic cadence (Reels for reach + Carrossell carousels for trust). ONLY after the user confirmed the list, captions, account and times — then confirm:true.",
    inputSchema: objectSchema(
      {
        posts: { type: "array", minItems: 1, maxItems: 60, items: objectSchema({ video: string("Absolute path of the MP4."), caption: string("Caption.", { maxLength: 2200 }) }, ["video"]) },
        time: string("HH:MM local time for one post a day, e.g. 18:00 (shortcut for times: [time])."),
        times: { type: "array", minItems: 1, maxItems: 5, items: string("HH:MM"), description: "1 to 5 daily times, e.g. [\"12:00\",\"18:00\"]; at least 1 hour apart." },
        days: { description: "\"daily\", \"alternate\" or weekdays [0-6] (0 = Sunday).", anyOf: [{ type: "string", enum: ["daily", "alternate"] }, { type: "array", minItems: 1, maxItems: 7, items: { type: "integer", minimum: 0, maximum: 6 } }] },
        pilot: { type: "boolean", description: "Mark the posts as part of the autopilot (paused with it)." },
        everyDays: number("Days between posts (default 1).", { minimum: 1, maximum: 14 }),
        account: string("Account id or @username."),
        confirm: { type: "boolean", enum: [true] },
      },
      ["posts", "confirm"],
    ),
  },
  {
    name: "cancel_scheduled_reel",
    description: "Cancel a scheduled Reel by id (from instagram_accounts.scheduled).",
    inputSchema: objectSchema({ id: string("Scheduled Reel id.") }, ["id"]),
  },
  {
    name: "publish_reel",
    description:
      "Publish an MP4 from Videos/CutRoom as an Instagram Reel through the user's Composio connection. ONLY after the user explicitly confirmed in chat this exact video, caption and account — then pass confirm:true. Posting is public and cannot be undone. Answers status 'publishing' within 40 s; check job_status (job 'publish') instead of calling again.",
    inputSchema: objectSchema(
      {
        video: string("Absolute path of the MP4 (render_film output)."),
        caption: string("Post caption (max 2200 chars). Include the CC BY music credit when there is one.", { maxLength: 2200 }),
        account: string("Account id or @username from instagram_accounts (default: the user's default)."),
        shareToFeed: { type: "boolean", description: "Also show in the profile feed (default true)." },
        confirm: { type: "boolean", enum: [true], description: "true only after explicit user confirmation." },
      },
      ["video", "confirm"],
    ),
  },
  {
    name: "render_film",
    description:
      "Render the film to MP4 (1080p, 30 fps, audio normalized to -14 LUFS / 48 kHz for Reels) into Videos/CutRoom. Runs in the background: answers status 'rendering' within 40 s; call render_film again (same film, without editing it) every ~60 s until status 'done' with the output path. Refuses films that fail film_check.",
    inputSchema: objectSchema({ film: string("Film id.") }, ["film"]),
  },
];
