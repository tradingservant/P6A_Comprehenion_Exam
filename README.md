# P6A_Comprehenion_Exam

Static two-station Primary 6 reading-comprehension practice. The repository name is the one used for this project.

Open `index.html` with a local static server so the page can load `data/exercises.json` and `data/passages.md`. Links are relative, so the page can be served from a subpath. Scores stay in the page only and clear on reset or reload.

```bash
npm test
```

`npm test` checks the exercise pack and runs a headless Chrome flow. It uses `CHROME_PATH` when set, otherwise `/usr/bin/google-chrome`.
