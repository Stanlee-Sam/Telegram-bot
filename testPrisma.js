const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const test = await prisma.$queryRaw`SELECT 1 as connected;`;
  console.log("✅ Connected:", test);
}

main()
  .catch((e) => {
    console.error("❌ Prisma failed:", e);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
