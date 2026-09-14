# bigbid

Mobile web app for HiBid lot capture (no-login MVP).

## Flow

1. Pallet number + Seller Code (remembered on device)
2. Product codes auto-assigned from pallet rule
3. Capture up to 10 photos per lot
4. Finish photos → OpenAI fills title, description, sale price, start bid
5. Complete → `{palletId}_lots.csv` email/download + photos ZIP

## OpenAI API key

Create `bigbid/.env.local`:

```bash
cp .env.example .env.local
```

Then set:

```
VITE_OPENAI_API_KEY=sk-...
```

Restart `npm run dev` after changing the key.

Note: this MVP calls OpenAI from the browser, so the key is visible in the client bundle. Fine for personal use; use a backend proxy before sharing publicly.

## Run

```bash
cd bigbid
npm install
npm run dev
```

## Deploy on Render (Static Site)

Create a **Static Site** from [bibibigbar-dev/bigbid](https://github.com/bibibigbar-dev/bigbid):

| Setting | Value |
|--------|--------|
| Build Command | `npm install && npm run build` |
| Publish Directory | `dist` |

Environment (Build):

```
VITE_OPENAI_API_KEY=sk-...
```

Vite bakes this key into the client bundle at **build time**, so set it in Render before building and redeploy after changing it.

Or use the included `render.yaml` Blueprint.

## CSV columns

`Lot Number, Sale Order, Title, Description, Start Bid Each, Seller Code`
