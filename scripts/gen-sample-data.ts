/**
 * Deterministic generator for data/sample_companies.csv.
 * All companies are fictional and use the reserved ".example" TLD (RFC 2606),
 * so no real website is ever contacted for them.
 * Run: npx tsx scripts/gen-sample-data.ts
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import Papa from "papaparse";

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261007);
const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)];
const int = (min: number, max: number) => Math.floor(rnd() * (max - min + 1)) + min;

interface Industry {
  name: string;
  nouns: string[];
  services: string[];
  size: [number, number];
}

const INDUSTRIES: Industry[] = [
  { name: "HVAC", nouns: ["Heating & Air", "Climate Control", "Comfort Systems", "Mechanical"], services: ["residential and light-commercial heating and cooling installation", "furnace and AC repair and seasonal maintenance contracts"], size: [8, 60] },
  { name: "Plumbing", nouns: ["Plumbing", "Plumbing & Drain", "Pipe Works"], services: ["emergency plumbing, drain cleaning and water-heater replacement", "new-construction plumbing for local home builders"], size: [5, 45] },
  { name: "Landscaping", nouns: ["Landscape Co.", "Lawn & Garden", "Grounds Care"], services: ["commercial grounds maintenance and snow removal contracts", "residential landscape design, installation and irrigation"], size: [10, 80] },
  { name: "Dental Practice", nouns: ["Family Dental", "Dental Care", "Smiles Dentistry"], services: ["general and cosmetic dentistry for families", "preventive dental care with in-house hygiene services"], size: [6, 30] },
  { name: "Veterinary", nouns: ["Animal Hospital", "Veterinary Clinic", "Pet Care Center"], services: ["small-animal wellness, surgery and emergency care", "mixed-animal veterinary services for rural clients"], size: [8, 40] },
  { name: "Auto Repair", nouns: ["Auto Service", "Automotive", "Garage & Tire"], services: ["independent auto repair, state inspections and fleet maintenance", "collision repair and paint with insurance-direct billing"], size: [5, 35] },
  { name: "Commercial Cleaning", nouns: ["Janitorial", "Cleaning Services", "Facility Services"], services: ["nightly janitorial service for offices, clinics and schools", "floor care, carpet extraction and post-construction cleaning"], size: [15, 120] },
  { name: "Accounting", nouns: ["CPA Group", "Tax & Accounting", "Bookkeeping Partners"], services: ["tax preparation, bookkeeping and payroll for small businesses", "outsourced accounting and advisory for local owner-operated firms"], size: [4, 28] },
  { name: "Insurance Agency", nouns: ["Insurance Group", "Insurance Services", "Risk Advisors"], services: ["independent agency placing home, auto and commercial policies", "benefits and commercial insurance brokerage for local employers"], size: [5, 30] },
  { name: "Print & Signage", nouns: ["Printing", "Sign Company", "Graphics & Print"], services: ["commercial printing, large-format signage and vehicle wraps", "short-run digital printing and direct-mail fulfillment"], size: [8, 50] },
  { name: "Machine Shop", nouns: ["Machine & Tool", "Precision Machining", "Fabrication"], services: ["CNC machining and short-run precision parts for regional manufacturers", "custom metal fabrication and welding for industrial customers"], size: [12, 90] },
  { name: "Pest Control", nouns: ["Pest Solutions", "Exterminating", "Pest Control"], services: ["recurring residential and commercial pest-control route services", "termite inspection, treatment and wildlife exclusion"], size: [6, 50] },
  { name: "Roofing", nouns: ["Roofing", "Roofing & Exteriors", "Roof Systems"], services: ["residential re-roofing and storm-damage repair", "commercial flat-roof installation and maintenance programs"], size: [10, 70] },
  { name: "Electrical Contractor", nouns: ["Electric", "Electrical Services", "Power & Lighting"], services: ["commercial tenant-improvement electrical work and service calls", "residential electrical repair, panel upgrades and EV chargers"], size: [8, 65] },
  { name: "Trucking & Freight", nouns: ["Freight", "Trucking", "Logistics"], services: ["regional LTL and dedicated truckload freight", "last-mile delivery and warehousing for local retailers"], size: [15, 110] },
  { name: "Self-Storage", nouns: ["Self Storage", "Storage Centers", "Mini Storage"], services: ["three self-storage facilities with climate-controlled units", "RV and boat storage plus traditional self-storage"], size: [3, 15] },
  { name: "Laundry & Dry Cleaning", nouns: ["Cleaners", "Laundry", "Dry Cleaning"], services: ["dry cleaning, alterations and commercial linen pickup", "coin laundry and wash-dry-fold services"], size: [5, 30] },
  { name: "IT Managed Services", nouns: ["IT Solutions", "Technology Partners", "Managed IT"], services: ["managed IT support and cybersecurity for local small businesses", "break-fix IT, cabling and cloud migration for professional offices"], size: [6, 40] },
  { name: "Physical Therapy", nouns: ["Physical Therapy", "Rehab & Wellness", "Sports Rehab"], services: ["outpatient orthopedic physical therapy across several clinics", "pediatric and adult physical and occupational therapy"], size: [8, 45] },
  { name: "Funeral Services", nouns: ["Funeral Home", "Memorial Chapel", "Funeral & Cremation"], services: ["full-service funeral and cremation services", "pre-need planning and funeral services for local families"], size: [5, 25] },
  { name: "Pharmacy", nouns: ["Pharmacy", "Drug", "Compounding Pharmacy"], services: ["independent community pharmacy with delivery and compounding", "long-term-care pharmacy services for assisted-living facilities"], size: [6, 35] },
  { name: "SaaS", nouns: ["Software", "Labs", "Cloud"], services: ["venture-backed workflow automation software sold to enterprises", "a subscription analytics platform with a Series A funding round"], size: [20, 200] },
];

const FIRST = ["Tidewater", "Summit", "Ironwood", "Maplewood", "Lakeshore", "Redstone", "Cedar Ridge", "Harbor", "Prairie", "Silverline", "Bluebird", "Granite", "Pinecrest", "Oakridge", "Westfield", "Clearwater", "Northgate", "Hilltop", "Riverbend", "Eastside", "Keystone", "Heritage", "Pioneer", "Evergreen", "Sunrise", "Foxglove", "Copperfield", "Stonebridge", "Meadowbrook", "Brightpath", "Anchor", "Falcon", "Sterling", "Lakeview", "Ridgeline", "Crossroads", "Ashford", "Millstone", "Beacon", "Juniper", "Birchwood", "Wildflower", "Glenmont", "Rockport", "Kingsley", "Dunmore", "Larkspur", "Thornton", "Alder", "Whitaker"];

const PLACES: [string, string][] = [
  ["Columbus", "OH"], ["Dayton", "OH"], ["Toledo", "OH"], ["Pittsburgh", "PA"], ["Harrisburg", "PA"], ["Erie", "PA"],
  ["Rochester", "NY"], ["Syracuse", "NY"], ["Albany", "NY"], ["Hartford", "CT"], ["Worcester", "MA"], ["Manchester", "NH"],
  ["Raleigh", "NC"], ["Greensboro", "NC"], ["Charlotte", "NC"], ["Greenville", "SC"], ["Savannah", "GA"], ["Macon", "GA"],
  ["Tampa", "FL"], ["Orlando", "FL"], ["Jacksonville", "FL"], ["Knoxville", "TN"], ["Nashville", "TN"], ["Louisville", "KY"],
  ["Indianapolis", "IN"], ["Fort Wayne", "IN"], ["Grand Rapids", "MI"], ["Lansing", "MI"], ["Madison", "WI"], ["Green Bay", "WI"],
  ["Des Moines", "IA"], ["Omaha", "NE"], ["Wichita", "KS"], ["Tulsa", "OK"], ["Little Rock", "AR"], ["Birmingham", "AL"],
  ["Austin", "TX"], ["San Antonio", "TX"], ["Lubbock", "TX"], ["Boise", "ID"], ["Spokane", "WA"], ["Salem", "OR"],
  ["Sacramento", "CA"], ["Fresno", "CA"], ["Phoenix", "AZ"], ["Tucson", "AZ"], ["Albuquerque", "NM"], ["Denver", "CO"],
  ["Colorado Springs", "CO"], ["Salt Lake City", "UT"], ["Minneapolis", "MN"], ["Kansas City", "MO"],
];

const AREA: Record<string, string> = { OH: "614", PA: "717", NY: "585", CT: "860", MA: "508", NH: "603", NC: "919", SC: "864", GA: "912", FL: "813", TN: "865", KY: "502", IN: "317", MI: "616", WI: "608", IA: "515", NE: "402", KS: "316", OK: "918", AR: "501", AL: "205", TX: "512", ID: "208", WA: "509", OR: "503", CA: "916", AZ: "602", NM: "505", CO: "303", UT: "801", MN: "612", MO: "816" };

const OWNER_PHRASES = [
  "Family-owned and operated for {gen} generations, led day to day by the founder.",
  "Owner-operated: the owner is on site every day and personally knows most customers.",
  "Founded and still run by {owner}, who is looking at what comes next for the business.",
  "A locally owned small business with long-tenured staff and a loyal repeat-customer base.",
];
const NEUTRAL_PHRASES = [
  "Serving the {city} area with a reputation for reliable work and fair pricing.",
  "Most work comes from referrals and repeat customers across {state}.",
  "Certified, insured and trusted by local homeowners and businesses.",
];
const HIRING_PHRASES = [
  "We are growing fast and hiring multiple technicians and an office manager right now.",
  "Join our team: open positions in the field and in sales across several locations.",
];
const SLOWDOWN_PHRASES = ["No open positions at this time.", "Our small, steady team has stayed the same size for years."];
const FUNDING_PHRASES = ["Recently closed a funding round led by a venture investor to accelerate expansion.", "Backed by private equity as part of a multi-brand platform roll-up."];

const OWNERS = ["Dave Kowalski", "Maria Santos", "Tom Whitfield", "Linda Park", "Raymond Ellis", "Susan Okafor", "Greg Mueller", "Patricia Nguyen", "Frank DeLuca", "Karen Holloway"];

function slug(s: string) {
  return s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

interface Row {
  name: string;
  domain: string;
  industry: string;
  city: string;
  state: string;
  employees: number;
  founded_year: number;
  phone: string;
  email: string;
  description: string;
}

const rows: Row[] = [];
const usedNames = new Set<string>();

while (rows.length < 144) {
  const ind = pick(INDUSTRIES);
  const first = pick(FIRST);
  const noun = pick(ind.nouns);
  const name = `${first} ${noun}`;
  if (usedNames.has(name)) continue;
  usedNames.add(name);
  const [city, state] = pick(PLACES);
  const isSaaS = ind.name === "SaaS";
  const old = !isSaaS && rnd() < 0.55;
  const founded = isSaaS ? int(2014, 2022) : old ? int(1958, 1999) : int(2000, 2021);
  const employees = int(ind.size[0], ind.size[1]);
  const parts: string[] = [`${name} provides ${pick(ind.services)} in ${city}, ${state}.`];
  if (!isSaaS && rnd() < 0.6) {
    parts.push(pick(OWNER_PHRASES).replace("{gen}", pick(["two", "three"])).replace("{owner}", pick(OWNERS)));
  }
  if (old) parts.push(`Proudly serving customers since ${founded}.`);
  parts.push(pick(NEUTRAL_PHRASES).replace("{city}", city).replace("{state}", state));
  const r = rnd();
  if (r < 0.2) parts.push(pick(HIRING_PHRASES));
  else if (r < 0.45) parts.push(pick(SLOWDOWN_PHRASES));
  if (isSaaS || rnd() < 0.1) parts.push(pick(FUNDING_PHRASES));
  const domain = `${slug(name)}.example`;
  rows.push({
    name,
    domain: rnd() < 0.15 ? `www.${domain}` : domain,
    industry: ind.name,
    city,
    state,
    employees,
    founded_year: founded,
    phone: `(${AREA[state]}) ${int(200, 999)}-${String(int(0, 9999)).padStart(4, "0")}`,
    email: `${pick(["info", "contact", "hello", "office", "sales"])}@${domain}`,
    description: parts.join(" "),
  });
}

// Deliberate duplicates so the dedupe pipeline has something to find.
const dupes: Row[] = [];
for (const i of [3, 17, 41, 58, 77, 102]) {
  const src = rows[i];
  dupes.push({ ...src, name: src.name.toUpperCase(), domain: `https://www.${src.domain.replace(/^www\./, "")}/`, employees: src.employees + 1 });
}
for (const i of [9, 29, 63, 90, 120, 131]) {
  const src = rows[i];
  dupes.push({
    ...src,
    name: src.name.replace(/&/g, "and").replace(/\.$/, "") + " LLC",
    domain: `${slug(src.name)}-${slug(src.city)}.example`,
  });
}
rows.push(...dupes);

const out = Papa.unparse(rows, { columns: ["name", "domain", "industry", "city", "state", "employees", "founded_year", "phone", "email", "description"] });
mkdirSync(join(process.cwd(), "data"), { recursive: true });
writeFileSync(join(process.cwd(), "data", "sample_companies.csv"), out + "\n");
console.log(`Wrote ${rows.length} rows`);
