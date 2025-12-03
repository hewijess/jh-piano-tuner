# Open Piano Tuner (Web)

A simple open-source tuner that runs entirely in the browser and works on iPad, phones, and desktop.
It uses the Web Audio API to read from the microphone, detects pitch, and displays:

- Detected frequency (Hz)
- Nearest equal-tempered note (A0–C8)
- Cents sharp/flat with a moving needle

## Live usage

Once deployed via GitHub Pages, open the URL over **HTTPS**, tap **Start Microphone**, and play a single note on your piano (or any instrument).

On iOS / iPadOS, you can add it to your Home Screen from Safari to make it feel like an app.

## Development

No build step. Just static files.

- `index.html` – main page and layout
- `style.css` – styling
- `tuner.js` – Web Audio + pitch detection logic

## License

You can license this as MIT (or similar permissive license) if you publish it.
