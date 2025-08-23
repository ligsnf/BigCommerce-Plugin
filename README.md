# NextJS Sample App

This starter app includes all the files necessary to get started with a basic, hello world app. This app uses NextJS, BigDesign, Typescript, and React.

## Running the app in development

To get the app running locally, follow these instructions:

1. [Use Node 18+ and NPM 8+](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm#checking-your-version-of-npm-and-node-js). To check the running versions, use the following commands:

```shell
node -v
npm -v
```

2. Clone and/or fork the repo and install npm packages:

```shell
git clone git@github.com:bigcommerce/sample-app-nodejs.git my-bigcommerce-app
cd my-bigcommerce-app
npm install
```

3. To expose your app server using an HTTP tunnel, install [ngrok](https://www.npmjs.com/package/ngrok#usage) globally, then start the ngrok service.

You can use `npm` to install ngrok:

```shell
npm install -g ngrok
```

Alternatively, MacOS users can use the [homebrew](https://brew.sh/) package manager:

```shell
brew install ngrok
```

Start ngrok on port `3000` to expose the default Next.js server:

```shell
ngrok http 3000
```

4. Use the BigCommerce [Developer Portal](https://devtools.bigcommerce.com) to [register a draft app](https://developer.bigcommerce.com/api-docs/apps/quick-start#register-the-app). For steps 5-7, enter callbacks as `'https://{ngrok_url}/api/{auth || load || uninstall}'`. Get the `ngrok_url` from the ngrok terminal session.

```shell
https://12345.ngrok-free.app/api/auth # auth callback
https://12345.ngrok-free.app/api/load # load callback
https://12345.ngrok-free.app/api/uninstall # uninstall callback
```

5. Copy `.env-sample` to `.env`.

```shell
cp .env-sample .env
```

6. In the `.env` file, replace the `CLIENT_ID` and `CLIENT_SECRET` variables with the API account credentials in the app profile. To locate the credentials, find the app's profile in the [Developer Portal](https://devtools.bigcommerce.com/my/apps), then click **View Client ID**.

7. In the `.env` file, update the `AUTH_CALLBACK` variable with the `ngrok_url` from step 4.

8. In the `.env` file, enter a secret `JWT_KEY`. To support HS256 encryption, the JWT key must be at least 32 random characters (256 bits).

9. **Configure the data store.** In the `.env` file, specify the `DB_TYPE`.

   > The DB type must be either `firebase` or `mysql`.

   If using Firebase, supply the `FIRE_` config keys listed in the `.env` file. See the [Firebase quickstart (Google)](https://firebase.google.com/docs/firestore/quickstart).

   If using MySQL, supply the `MYSQL_` config keys listed in the `.env` file, then do the initial database migration by running the following npm script:

```shell
npm run db:setup
```

10. Start your dev environment in a dedicated terminal session, **separate from `ngrok`**.

```shell
npm run dev
```

> If `ngrok` expires, update the callbacks in steps 4 and 7 with the new `ngrok_url`. You can learn more about [persisting ngrok tunnels longer (ngrok)](https://ngrok.com/docs/getting-started/#step-3-connect-your-agent-to-your-ngrok-account).

11. Consult our developer documentation to [install and launch the app](https://developer.bigcommerce.com/api-docs/apps/quick-start#install-the-app).

## Webhook Management

This app automatically manages webhooks for BigCommerce stores. Webhooks are essential for real-time inventory management when bundle products are purchased.

### Automatic Webhook Registration

The app automatically creates and manages webhooks during the app lifecycle:

1. **During App Installation** (`/api/auth`): Creates webhooks for new store installations
2. **During App Loading** (`/api/load`): Ensures webhooks exist for existing installations (safety check)
3. **During App Uninstall** (`/api/uninstall`): Cleans up webhooks when the app is removed

### Webhook Configuration

The app registers the following webhook:
- **Event**: `store/order/created`
- **Destination**: `{APP_URL}/api/webhooks/orders`
- **Purpose**: Updates inventory levels for bundle products when orders are placed

### Manual Testing

For development and testing purposes, you can use the provided scripts:

#### Test Webhook Management
```shell
node scripts/test-webhook.js
```

This script will:
- List existing webhooks for your store
- Test the webhook creation process
- Verify webhook configuration

#### Legacy Manual Creation (Development Only)
```shell
node scripts/create-webhook.js
```

> **Note**: The manual script is only needed for local development. In production, webhooks are automatically managed by the app.

### Webhook Lifecycle

- **Creation**: Webhooks are automatically created when a store installs the app
- **Validation**: Each app load checks if webhooks exist and recreates them if missing
- **Cleanup**: Webhooks are automatically removed when the app is uninstalled
- **Resilience**: Webhook creation failures don't prevent app installation (logged for debugging)

### BigCommerce Webhook Behavior

- Webhooks remain active as long as the store is active
- Webhooks are automatically disabled after 90 days of store inactivity
- The app's safety checks ensure webhooks are recreated if they become missing
- No token refresh is needed for webhooks (they use the destination URL)

## Production builds

In production, you must build and run optimized version of the code. Use the following commands to get started:

> When you run the `start` script, specify a port number using the `-p` flag. Otherwise, the process will fail.

```shell
npm run build
npm run start -p 3000
```

## Chrome extension sidebar injection

You can run the app as a sidebar injected into BigCommerce product edit pages via a Chrome extension.

### Files

- `extension/manifest.json`
- `extension/background.js`
- `extension/content.js`
- `extension/options.html`
- `extension/options.js`

### What it does

- Adds a browser action. Clicking the extension icon dispatches a `BC_SIDEBAR_TOGGLE` event in the active tab.
- A content script listens for that event, creates a fixed-position sidebar `<iframe>`, and loads the app's product page UI at `/<app>/productAppExtension/{productId}?context=<JWT>`.
- The sidebar is only active on `https://store-*.mybigcommerce.com/manage/products/*` pages.

### Setup

1. Build and run this app somewhere accessible (e.g., `https://your-app.example.com`).
2. Launch the app from within BigCommerce once so the URL contains `?context=<JWT>`. Copy the `context` value.
3. In Chrome visit `chrome://extensions`, enable Developer mode, click "Load unpacked" and select the `extension/` folder.
4. Open the extension's Options page and set:
   - App Base URL: your app's public URL (e.g., `https://your-app.example.com`)
   - Context JWT: the `context` you copied
5. Go to a BigCommerce product edit page, then click the extension icon to toggle the sidebar.

### Notes

- The iframe points to `pages/productAppExtension/[productId]/index.tsx`, which already expects a `context` query.
- If the store context rotates, update the JWT in the extension options.
- The content script watches DOM changes and updates the iframe URL if you navigate to a different product while the sidebar is open.
