import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const ICPS = [
  {
    name: "Owner-operated home services (Midwest/Southeast)",
    industries: ["HVAC", "Plumbing", "Roofing", "Electrical Contractor", "Pest Control"],
    locations: ["OH", "IN", "MI", "NC", "TN", "GA"],
    minEmployees: 8,
    maxEmployees: 60,
    includeKeywords: ["family-owned", "owner-operated", "since", "residential"],
    excludeKeywords: ["venture", "private equity", "franchise"],
    signals: { ownerOperated: true, longEstablished: true, noRecentFunding: true, hiringSlowdown: false },
  },
  {
    name: "Healthcare & professional practices",
    industries: ["Dental Practice", "Veterinary", "Physical Therapy", "Accounting", "Insurance Agency"],
    locations: [],
    minEmployees: 5,
    maxEmployees: 45,
    includeKeywords: ["patients", "clients", "practice", "independent"],
    excludeKeywords: ["venture", "private equity"],
    signals: { ownerOperated: true, longEstablished: true, noRecentFunding: true, hiringSlowdown: true },
  },
];

const SUPPRESSIONS = [
  { type: "DOMAIN" as const, value: "optout-example.example", reason: "Sample opt-out: owner requested removal" },
];

async function main() {
  for (const icp of ICPS) {
    const existing = await prisma.icp.findFirst({ where: { name: icp.name } });
    if (!existing) await prisma.icp.create({ data: icp });
  }
  for (const s of SUPPRESSIONS) {
    await prisma.suppression.upsert({ where: { value: s.value }, update: {}, create: s });
  }
  await prisma.counter.upsert({ where: { key: "duplicatesRemoved" }, update: {}, create: { key: "duplicatesRemoved", value: 0 } });
  console.log("Seeded ICPs, suppression list and counters.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
