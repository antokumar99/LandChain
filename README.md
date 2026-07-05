# LandChain v1

Simple local stack for registering land records, generating owner commitments, building a Merkle root, and storing that root through the `LandRegistry` smart contract.

## Folder Structure

```text
apps/
  client/   Next.js frontend
  server/   Express API, MongoDB models, chain client
contracts/  Hardhat contracts and deployment script
circuits/   Circom proof tooling
```

## Local Checklist

1. Set the MongoDB Atlas URI in `apps/server/.env`:

   ```shell
   MONGO_URI=mongodb+srv://USER:PASSWORD@cluster0.example.mongodb.net/landchain?retryWrites=true&w=majority&appName=Cluster0
   ```

2. Start the local chain:

   ```shell
   cd contracts
   npm run node
   ```

3. Deploy the contracts in another terminal:

   ```shell
   cd contracts
   npm run deploy:local
   ```

4. Start the API:

   ```shell
   cd apps/server
   npm run dev
   ```

5. Start the frontend:

   ```shell
   cd apps/client
   npm run dev
   ```

The frontend defaults to `http://localhost:4000` for the API. Set `NEXT_PUBLIC_API_URL` in `apps/client/.env.local` if the server runs elsewhere.
