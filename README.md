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

## CSV columns

`Lot Number, Sale Order, Title, Description, Start Bid Each, Seller Code`
