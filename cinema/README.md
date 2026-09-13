# Fly / Thoughts web app

The full project guide, screenshots, setup instructions, and explanation of the neural-to-video mapping are in the [main README](../README.md).

From this directory:

```sh
npm ci
npm run exhibit
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). You need Node.js 20.9 or newer and a JDK 21 or newer. The combined launcher starts the local brain bridge and Next.js app.

For live video, create `.env.local` from [.env.example](.env.example), set your own `FAL_KEY`, and restart the app. Opening the page does not start generation. Selecting **Start cinema** begins billed generation. The local procedural study works without a key.

```sh
npm test
npm run typecheck
npm run build
```

See [VALIDATION.md](VALIDATION.md) for the scope of verification. Keys belong only in the ignored local environment file.
