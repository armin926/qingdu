# Implementation plan

Approved 2026-10-28. Use native Manifest V3 modules with no runtime dependencies.

1. Implement local-only voice selection, sentence splitting, validated settings and a generation-guarded TTS controller. Test language detection, literal replacements, Unicode boundaries, pause/end races, delayed voices and stale callbacks.
2. Add user-triggered content extraction and safe CSS Highlight mapping; create a keyboard-accessible Chinese side panel for preview, playback, history, settings and imports.
3. Connect background persistence, context menus, shortcuts and a persistent sleep alarm. Bound stored articles and reject invalid messages.
4. Check actual browser rendering and content extraction; probe local TTS and extension loading when the host supports it. Explicitly distinguish real OS playback from API mocks.
5. Package only runtime files. Document installation, privacy, research evidence, validation and an evidence-based roadmap. Upload the complete project to the approved private GitHub repository.
