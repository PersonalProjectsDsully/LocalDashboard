# LocalDashboard
# **Projects Hub — Master Project Plan (v1.0‑alpha)**  
*A local‑first desktop workspace with projects, tasks, docs, alarms, workspace‑snap, and a new **Focus Monitor** that tracks active‑window time & screenshots.*

---

## 0 · Solution Overview

| Layer | Role |
|-------|------|
| **Tauri desktop shell (Rust + React)** | Renders UI, handles global hotkeys, shows Windows toasts. |
| **FastAPI backend (Python 3.12, Docker)** | CRUD for YAML/MD files, WebSocket hub, alarm engine, daily summary builder, Git auto‑commit. |
| **Workspace Snap agent (Python, host)** | Launches & tiles apps per `workspace_layout.json`; reports progress. |
| **Focus Monitor agent (Python, host)** | Logs active window, grabs periodic screenshots, runs Tesseract OCR, produces daily usage summaries. |

All data lives in **plain files** under a user‑chosen `ProjectsHub/` folder and is hot‑watched for real‑time UI refresh.

---

## 1 · User‑Facing Feature Matrix

| Area | Core MVP Features |
|------|-------------------|
| **Dashboard** | • Quick‑action bar (*Start Workspace*, *Cmd K palette*, *New Project*)<br>• “Big alarms” cards<br>• Pinned docs list<br>• **Focus Report** tab (pie chart, timeline, screenshot gallery) |
| **Sidebar** | • Navigation icons (Projects, Docs, Tasks)<br>• Live alarm pills (green/amber/red)<br>• “+ Add alarm” button |
| **Projects / Docs** | • Kanban board from `tasks.yaml` (drag‑drop)<br>• Markdown editor/preview with autosave & conflict banner |
| **Workspace Snap** | • One‑click (and palette) layout<br>• Minimises unlisted apps<br>• Logs to Activity feed |
| **Command Palette** | • `Ctrl + Space` overlay (kbar) — search commands, docs, tasks, alarms |
| **Activity Feed** | • Real‑time log of saves, Git commits, snap steps<br>• Quiet‑mode toggle |
| **Focus Monitor** | • Tracks active window, screenshots, OCR<br>• Daily summary JSON → Dashboard Focus Report<br>• “Pause tracking” toggle |

*Optional future*: Grafana dashboard cards and Voice ↔ Voice assistant.

---

## 2 · File & Schema Conventions

```
ProjectsHub/
├─ 00‑meta.yaml            # UI prefs (theme, feed quiet hours)
├─ countdowns.yaml         # alarms (days + time + thresholds)
├─ workspace_layout.json   # app → monitor region mapping
├─ focus_logs/             # JSONL + PNG + OCR txt per day
├─ templates/              # new‑project skeletons
└─ Project‑Foo/
    ├─ project.yaml        # title, status, tags, due
    ├─ tasks.yaml          # simple Kanban structs
    ├─ docs/*.md           # CommonMark + front‑matter
    └─ assets/…
```

---

## 3 · Architecture Diagram

```
┌──────────────────────────────── Desktop App (Tauri) ──────────────────────────────┐
│ React UI  ·  Command Palette  ·  Toasts  ·  "Pause tracking" switch               │
└────────────────────────────────────────▲───────────────────────────────────────────┘
                                         │ WebSocket (logs, alarms)
                                         ▼ REST
┌────────────────────────────── FastAPI backend (Docker) ────────────────────────────┐
│ /files  /tasks  /alarms  /focus/summary  |  watchdog FS events → WS push           │
│ Alarm engine (async loop)                |  Git autocommit                        │
│ Daily summary builder (reads focus_logs) |                                         │
└────────────────────────────────▲───────────────────────────────────────────────────┘
                                 │ localhost JSON APIs
┌──────── Workspace Snap agent (host) ───────┐   ┌──────── Focus Monitor agent (host) ──────┐
│ pywinauto · win32gui · screeninfo          │   │ win32 GetForegroundWindow / mss screenshot│
│ Arranges windows, posts /log               │   │ JSONL + PNG + OCR txt → focus_logs/       │
└────────────────────────────────────────────┘   └──────────────────────────────────────────┘
```

---

## 4 · Docker Compose (MVP)

```yaml
services:
  backend:
    build: docker/backend
    volumes: [ ./ProjectsHub:/hub_data ]
    ports: [ "8000:8000" ]

  tauri_builder:            # one‑shot build container
    build: docker/tauri
    volumes: [ ./tauri:/src, ./artifacts:/dist ]
    command: ["/src/build.sh"]   # emits signed MSI/DMG

# (Workspace Snap & Focus Monitor run as tiny host‑side Python venvs)
```

*Switching Docker to Windows‑containers mode is **optional** and only required if you want both agents containerised.*  

---

## 5 · Seven‑Week Delivery Timeline

| Week | Phase | Key Deliverables |
|------|-------|------------------|
| **0 (½ wk)** | Foundations | Repo, CI, issue board, dev‑container. |
| **1** | Core scaffolding | FastAPI & Tauri skeleton; static sidebar/tabs. |
| **2** | Live file sync | watchdog → WS; Git auto‑commit; UI hot‑reload. |
| **3** | Alarms | YAML schema, engine, sidebar pills, add/edit modal, desktop toasts. |
| **4** | Projects & Docs | Markdown editor w/ autosave; Kanban board; pinned docs. |
| **5** | Workspace Snap | JSON layout validator; pywinauto agent; logs to feed. |
| **5.5** | Palette & Feed | kbar overlay; quiet‑mode drawer polish. |
| **6** | **Focus Monitor** | Window tracker, screenshot/OCR, daily summary, Focus Report tab, privacy toggle. |
| **7 (½ wk)** | QA & Packaging | Playwright e2e; signed installer; README user guide. |

---

## 6 · Phase‑6 (Focus Monitor) Tasks

| Task | Success Criteria |
|------|------------------|
| Tracker loop | 5‑sec sampling; JSONL lines `{ts, exe, title}`. |
| Screenshot capture | PNG on change or max 60 s; ≤ 40 MB/day. |
| OCR extraction | TXT sidecar with first 256 chars (eng). |
| Daily summariser | `daily_summary_YYYY‑MM‑DD.json` (totals + keywords). |
| API + UI | `/focus/summary?date=` returns JSON; Dashboard tab shows pie chart & gallery. |
| Privacy switch | Toggle stops new logs & images immediately. |

---

## 7 · Optional Epics (Post‑MVP)

| Epic | Extra Effort |
|------|--------------|
| **A Grafana Dashboards** | Add Grafana container → Dashboard iframe list from `00‑meta.yaml`. |
| **B Voice ↔ Voice Assistant** | Precise hot‑word, whisper.cpp ASR, LLM skills, Orpheus TTS. |

---

## 8 · Success Criteria for MVP

1. **Installer + Docker compose** yield a fully working local app on Windows.  
2. User can create/edit projects, tasks, docs **without touching raw files**.  
3. Alarms fire visually & audibly, are editable in the UI.  
4. Workspace Snap arranges windows in ≤ 5 s, minimises others.  
5. Focus Report shows accurate time‑per‑app and last screenshots; privacy toggle works.  
6. Quiet‑mode hides feed; command palette finds everything.  

---

### Ready to Execute?

* Start **Phase 0** by initialising the repo and dev‑container.  
* Open issues labelled `phase-1` for schema, backend & UI scaffolds.  
* Kick off stand‑ups with the seven‑week roadmap as your sprint calendar.

Let me know whenever you need a deeper dive into a specific phase or code scaffold!
