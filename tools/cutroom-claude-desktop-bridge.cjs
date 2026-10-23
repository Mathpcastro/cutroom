#!/usr/bin/env node
/**
 * CutRoom MCP Bridge for Claude Desktop
 * Communicates with Claude Desktop via stdio and connects to the active CutRoom instance.
 */

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const readline = require("node:readline");

function getCutRoomUserDataDir() {
  if (process.platform === "darwin") {
    return path.join(
      os.homedir(),
      "Library",
      "Application Support",
      "cutroom"
    );
  }
  if (process.platform === "win32") {
    return path.join(
      process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
      "cutroom"
    );
  }
  return path.join(os.homedir(), ".config", "cutroom");
}

function getCutRoomConnectionInfo() {
  const infoPath = path.join(getCutRoomUserDataDir(), "claude-desktop-mcp.json");
  try {
    if (!fs.existsSync(infoPath)) return null;
    const raw = fs.readFileSync(infoPath, "utf8");
    const data = JSON.parse(raw);
    if (!data.url || !data.token) return null;
    // Check if the process is alive (if pid is provided)
    if (data.pid && typeof data.pid === "number") {
      try {
        process.kill(data.pid, 0);
      } catch (err) {
        // Process is dead
        return null;
      }
    }
    return data;
  } catch {
    return null;
  }
}

async function forwardToCutRoom(rpcRequest, connectionInfo) {
  try {
    const res = await fetch(connectionInfo.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${connectionInfo.token}`,
      },
      body: JSON.stringify(rpcRequest),
    });
    if (!res.ok) {
      throw new Error(`CutRoom MCP retornou HTTP ${res.status}`);
    }
    return await res.json();
  } catch (err) {
    return {
      jsonrpc: "2.0",
      id: rpcRequest.id,
      result: {
        isError: true,
        content: [
          {
            type: "text",
            text: `Erro ao comunicar com o CutRoom: ${err.message}. Verifique se o CutRoom está aberto e respondendo.`,
          },
        ],
      },
    };
  }
}

const EDITOR_TOOLS = [
  {
    name: "get_project",
    description:
      "Read the current video project, media, clip IDs, source timings, settings, and transcript words. Call before editing. Paths are descriptive; use only editor tools.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "edit_project",
    description:
      "Apply one reversible editor command. All times are SOURCE seconds, except overlay start/end which use timeline seconds. Commands and args: rename{name}; trim{clipId,start,end}; split{clipId,time}; delete_clip{clipId}; remove_range{mediaId,start,end,clipId?}; zoom{factor,clipId?,focusX?,focusY?}; speed{factor,clipId?,muted?}; captions{enabled,style?:{presetId?,fontFamily?,fontSize?,color?,activeColor?,position?,margin?,maxWords?,mode?,animation?,background?,backgroundColor?,backgroundOpacity?,outline?,outlineColor?,casing?,bold?,italic?,spacing?}}; normalize{enabled,targetLufs?}; overlay{kind:title|statement|callout|flow|promo|cover,text,start,end}; remove_silence{} (the editor detects actual silences); remove_fillers{}; preset{}; hook{mediaId,start,end,move?}; reset{}. Speech-based commands automatically transcribe if the local package is installed; report a missing package accurately. Caption fonts: Barlow, Montserrat, Anton, Lora, Oswald, Caveat. Colors are #RRGGBB. Caption positions top/center/bottom; modes phrase/highlight/karaoke/word/cumulative/typewriter/emphasis; animations none/fade/pop/bounce/rise/slide; backgrounds none/box/pill; casing original/upper/lower. Set presetId to select a complete style, then optional overrides. Caption presets: studio-highlight, clean-phrase, documentary, cinema, karaoke, karaoke-box, word-pop, word-bounce, word-slide, word-pill, build-up, typewriter, build-up-top, pill-phrase, boxed-caption, highlight-pill, social-impact, social-stack, keyword-punch, news-top, handwritten, quiet-center, lecture, headline-sweep. Image/interval command uses TIMELINE seconds: clip_style{start,end,look?:none|monochrome|cinema|vivid|blur|vignette|color-wipe,factor?:zoom1to4,speed?:0.1to16,muted?:boolean,mirrored?:boolean}. Splits only interval boundaries; unrelated content is preserved. HyperFrames animation commands use TIMELINE seconds: motion{id? (edit existing),name?,start,end,mode:overlay|fullscreen,presetId:title|lower-third|highlight|steps|stat|explainer,text,subtitle?,items?:string[],accent?:#RRGGBB,background?:#RRGGBB}; delete_motion{id}. Use transcript and clip speeds/cuts to map speech to actual timeline time. Preserve unrelated edits. Never invent speech or timing.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          enum: [
            "rename",
            "trim",
            "split",
            "delete_clip",
            "remove_range",
            "zoom",
            "speed",
            "clip_style",
            "captions",
            "normalize",
            "overlay",
            "motion",
            "delete_motion",
            "remove_silence",
            "remove_fillers",
            "preset",
            "hook",
            "reset",
          ],
        },
        args: {
          type: "object",
          additionalProperties: true,
        },
      },
      required: ["name", "args"],
      additionalProperties: false,
    },
  },
  {
    name: "transcribe",
    description:
      "Transcribe imported videos locally using the CutRoom transcription engine. Use for speech-driven edits when words are missing. May take several minutes.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "export_video",
    description:
      "Open the native save dialog in CutRoom and export the current timeline as video. Only call when the user asks to export or render.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "inspect_frame",
    description:
      "Inspect an actual source video frame from CutRoom. Supply an existing mediaId and source time in seconds. Returns the frame image directly so you can see it.",
    inputSchema: {
      type: "object",
      properties: {
        mediaId: { type: "string" },
        time: { type: "number", minimum: 0 },
      },
      required: ["mediaId", "time"],
      additionalProperties: false,
    },
  },
  {
    name: "create_blank_canvas",
    description:
      "Create a clean solid background video canvas in CutRoom (e.g. for motion graphics from scratch, title sequences, or animations when no video footage has been imported). Sets up the timeline so motion scenes and animations can be created.",
    inputSchema: {
      type: "object",
      properties: {
        duration: {
          type: "number",
          description: "Duration in seconds (e.g. 10, 15, 30). Defaults to 15.",
          minimum: 1,
          maximum: 600,
        },
        color: {
          type: "string",
          description:
            "Hex color for background (e.g. #151515, #000000, #FF6B0B). Defaults to #151515.",
        },
        name: {
          type: "string",
          description: "Name for the canvas project. Defaults to 'Canvas Motion'.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "import_media",
    description:
      "Import one or more local video or media files into CutRoom by their absolute file paths. This adds the media to the project and places clips on the timeline.",
    inputSchema: {
      type: "object",
      properties: {
        paths: {
          type: "array",
          items: { type: "string" },
          description: "Array of absolute file paths to import into CutRoom",
        },
      },
      required: ["paths"],
      additionalProperties: false,
    },
  },
];

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

rl.on("line", async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let req;
  try {
    req = JSON.parse(trimmed);
  } catch {
    return;
  }

  const { id, method, params } = req;
  if (!method) return;

  if (method === "initialize") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: "cutroom",
          version: "1.0.0",
        },
      },
    });
    return;
  }

  if (method === "notifications/initialized") {
    return;
  }

  if (method === "ping") {
    send({ jsonrpc: "2.0", id, result: {} });
    return;
  }

  if (method === "tools/list") {
    const conn = getCutRoomConnectionInfo();
    if (conn) {
      try {
        const liveTools = await forwardToCutRoom(req, conn);
        if (liveTools && liveTools.result && liveTools.result.tools) {
          send(liveTools);
          return;
        }
      } catch {}
    }
    // Fallback to static tools list
    send({
      jsonrpc: "2.0",
      id,
      result: {
        tools: EDITOR_TOOLS,
      },
    });
    return;
  }

  if (method === "tools/call") {
    const conn = getCutRoomConnectionInfo();
    if (!conn) {
      send({
        jsonrpc: "2.0",
        id,
        result: {
          isError: true,
          content: [
            {
              type: "text",
              text: "O CutRoom não está aberto no momento. Por favor, abra o aplicativo CutRoom no seu computador e adicione o seu vídeo para que eu possa inspecionar a timeline e fazer as edições.",
            },
          ],
        },
      });
      return;
    }

    const response = await forwardToCutRoom(req, conn);
    send(response);
    return;
  }

  // Unknown method
  if (id !== undefined) {
    send({
      jsonrpc: "2.0",
      id,
      error: {
        code: -32601,
        message: `Method ${method} not supported`,
      },
    });
  }
});
