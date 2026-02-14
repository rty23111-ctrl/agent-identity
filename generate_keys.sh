

#!/bin/bash

set -e

echo "🔐 Regenerating RSA keypair..."

# 1. Generate private key (PKCS#8)
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out private.pem

# 2. Generate public key (SPKI)
openssl rsa -in private.pem -pubout -out public.pem

echo "✅ Keys generated: private.pem + public.pem"

echo "🔧 Updating Wrangler secrets..."

# 3. Push to Wrangler secrets
cat private.pem | wrangler secret put PRIVATE_KEY
cat public.pem  | wrangler secret put PUBLIC_KEY

echo "✅ Wrangler secrets updated."

echo "📝 Writing .dev.vars for local development..."

# 4. Write .dev.vars with quoted PEM blocks
{
  echo 'PRIVATE_KEY="'; sed 's/$/\\n/' private.pem; echo '"'
  echo 'PUBLIC_KEY="'; sed 's/$/\\n/' public.pem; echo '"'
} > .dev.vars

echo "✅ .dev.vars updated."

echo "🎉 All done. Local + production environments now have fresh keys."
