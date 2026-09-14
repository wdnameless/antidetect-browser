// Coherent per-profile persona generation (parity program: form-filling-helper).
//
// Determinism follows the house idiom: HMAC-SHA256 with the fingerprint-domain
// secret and a `persona:{domain}` label, exactly like `deriveMotorSeed`
// (`seeds.ts`). The same profile seed always produces the same person, across
// processes, forever. Two different seeds never share a name, address, email,
// phone or card.
//
// Coherence is the point: email local part derives from the name, postcode and
// region agree for the chosen country, phone matches the country's national
// shape, the card passes Luhn with a future expiry, and the date of birth
// yields an adult age. All locale knowledge lives in the LOCALES table — data,
// not branching logic.
import * as crypto from 'crypto';
import { HMAC_SECRET, MIN_SEED, MAX_SEED } from '../fingerprints/derivation';

export interface PersonaCard {
  /** 16-digit PAN passing the Luhn check. */
  number: string;
  /** MM/YY, strictly in the future relative to the persona clock. */
  expiry: string;
  cvv: string;
}

export interface Persona {
  givenName: string;
  familyName: string;
  fullName: string;
  /** Street address line (number + street). */
  address: string;
  city: string;
  /** State / province / county — agrees with `postcode`. */
  region: string;
  postcode: string;
  /** ISO 3166-1 alpha-2 country code. */
  country: string;
  phone: string;
  email: string;
  /** YYYY-MM-DD, always an adult age. */
  dateOfBirth: string;
  card: PersonaCard;
}

export interface PersonaOptions {
  /** ISO 3166-1 alpha-2 country; defaults to 'US'. Unknown codes fall back to US. */
  country?: string;
  /** Clock for expiry/DOB decisions; defaults to Date.now(). Deterministic for a fixed value. */
  now?: number;
}

export const PERSONA_COUNTRIES = ['US', 'GB', 'DE', 'FR'] as const;
export type PersonaCountry = (typeof PERSONA_COUNTRIES)[number];

export const PERSONA_FIELDS = [
  'givenName',
  'familyName',
  'fullName',
  'address',
  'city',
  'region',
  'postcode',
  'country',
  'phone',
  'email',
  'dateOfBirth',
  'card.number',
  'card.expiry',
  'card.cvv',
] as const;
export type PersonaField = (typeof PERSONA_FIELDS)[number];

interface LocaleRegion {
  name: string;
  /** Postcode seed for this region (prefix / leading digits). */
  post: string;
  /** Phone area code / leading digits for this region. */
  area: string;
}

interface Locale {
  country: string;
  given: readonly string[];
  family: readonly string[];
  streets: readonly string[];
  cities: readonly string[];
  regions: readonly LocaleRegion[];
  /** postcode shape: region.post + per-locale expansion. */
  zip: (seed: number, region: LocaleRegion) => string;
  /** national phone shape. */
  phone: (seed: number, region: LocaleRegion) => string;
  emailDomains: readonly string[];
}

const LOCALES: Record<PersonaCountry, Locale> = {
  US: {
    country: 'US',
    given: ['James', 'Mary', 'Robert', 'Patricia', 'John', 'Jennifer', 'Michael', 'Linda', 'David', 'Elizabeth', 'William', 'Barbara', 'Richard', 'Susan', 'Joseph', 'Jessica', 'Thomas', 'Sarah', 'Charles', 'Karen', 'Christopher', 'Nancy', 'Daniel', 'Lisa', 'Matthew', 'Betty', 'Anthony', 'Margaret', 'Mark', 'Sandra', 'Donald', 'Ashley'],
    family: ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson', 'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson', 'Walker', 'Young'],
    streets: ['Maple Ave', 'Oak St', 'Cedar Ln', 'Lakeview Dr', 'Sunset Blvd', 'Hillcrest Rd', 'Pine Grove', 'Market St'],
    cities: ['Austin', 'Denver', 'Portland', 'Columbus', 'Raleigh', 'Phoenix'],
    regions: [
      { name: 'CA', post: '9', area: '415' },
      { name: 'NY', post: '1', area: '212' },
      { name: 'TX', post: '7', area: '214' },
      { name: 'CO', post: '8', area: '303' },
      { name: 'FL', post: '3', area: '305' },
      { name: 'WA', post: '98', area: '206' },
    ],
    zip: (seed, region) => `${region.post}${String(1000 + (seed % 9000)).padStart(4, '0')}`,
    phone: (seed, region) => {
      const n = 1000000 + (seed % 9000000);
      return `+1${region.area}${String(n).padStart(7, '0')}`;
    },
    emailDomains: ['gmail.com', 'outlook.com', 'yahoo.com', 'proton.me'],
  },
  GB: {
    country: 'GB',
    given: [
      'Oliver', 'Amelia', 'Harry', 'Isla', 'George', 'Freya', 'Theodore', 'Poppy',
      'Jack', 'Olivia', 'Noah', 'Emily', 'Alfie', 'Sophie', 'Archie', 'Grace',
      'Charlie', 'Lily', 'Freddie', 'Evie', 'Oscar', 'Florence', 'Henry', 'Willow',
      'Thomas', 'Alice', 'Joshua', 'Rosie', 'William', 'Charlotte', 'James', 'Maisie',
    ],
    family: [
      'Taylor', 'Brown', 'Wilson', 'Evans', 'Thomas', 'Roberts', 'Johnson', 'Wright',
      'Walker', 'Robinson', 'Thompson', 'White', 'Hughes', 'Edwards', 'Green', 'Hall',
      'Wood', 'Harris', 'Martin', 'Jackson', 'Clarke', 'Turner', 'Hill', 'Moore',
      'Cooper', 'Ward', 'Morris', 'Bell', 'Shaw', 'Bennett', 'Foster', 'Gray',
    ],
    streets: ['High St', 'Station Rd', 'Church Lane', 'Mill Road', 'Park Avenue', 'Queen Street', 'Victoria Rd', 'Green Lane'],
    cities: ['London', 'Manchester', 'Bristol', 'Leeds', 'Edinburgh', 'Cardiff'],
    regions: [
      { name: 'London', post: 'W', area: '70' },
      { name: 'Greater Manchester', post: 'M', area: '71' },
      { name: 'Bristol', post: 'BS', area: '75' },
      { name: 'West Yorkshire', post: 'LS', area: '74' },
      { name: 'Edinburgh', post: 'EH', area: '77' },
      { name: 'Cardiff', post: 'CF', area: '73' },
    ],
    // UK postcode shape: outward (area letters + digit, optional letter) SPACE
    // inward (digit + two letters). e.g. "W1 4AB", "BS1 7CD".
    zip: (seed, region) => {
      const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      const outwardDigit = 1 + (seed % 9);
      const inwardDigit = 1 + ((seed >>> 6) % 9);
      const a = letters[(seed >>> 3) % 26];
      const b = letters[(seed >>> 9) % 26];
      return `${region.post}${outwardDigit} ${inwardDigit}${a}${b}`;
    },
    // UK mobile: +44 7xxx xxxxxx — the area carries the leading 7 the operator
    // dials, so it must be spaced off the subscriber number.
    phone: (seed, region) => {
      void region;
      const n = 1000000 + (seed % 9000000);
      const area = `7${String(seed % 10)}${String(Math.floor(n / 10000)).padStart(3, '0')}`;
      const subscriber = String(n % 10000).padStart(4, '0');
      return `+44 ${area} ${subscriber}`;
    },
    emailDomains: ['gmail.com', 'outlook.com', 'icloud.com', 'proton.me'],
  },
  DE: {
    country: 'DE',
    given: ['Felix', 'Lena', 'Jonas', 'Laura', 'Maximilian', 'Mia', 'Paul', 'Hannah', 'Leon', 'Emma', 'Ben', 'Sophie', 'Elias', 'Marie', 'Niklas', 'Anna', 'Lukas', 'Lea', 'Finn', 'Clara', 'Julian', 'Johanna', 'Moritz', 'Leonie', 'Tim', 'Lina', 'Jan', 'Emily', 'Erik', 'Mila', 'Simon', 'Ida'],
    family: ['Muller', 'Schmidt', 'Schneider', 'Fischer', 'Weber', 'Meyer', 'Wagner', 'Becker', 'Schulz', 'Hoffmann', 'Schafer', 'Koch', 'Bauer', 'Richter', 'Klein', 'Wolf', 'Schroder', 'Neumann', 'Schwarz', 'Zimmermann', 'Braun', 'Kruger', 'Hofmann', 'Hartmann', 'Lange', 'Schmitt', 'Werner', 'Schmitz', 'Krause', 'Meier', 'Lehmann', 'Kohl'],
    streets: ['Hauptstrasse', 'Bahnhofstrasse', 'Schulstrasse', 'Kirchweg', 'Gartenstrasse', 'Rathausplatz', 'Bergweg', 'Muhlenweg'],
    cities: ['Berlin', 'Munich', 'Hamburg', 'Cologne', 'Frankfurt', 'Stuttgart'],
    regions: [
      { name: 'Bayern', post: '80', area: '89' },
      { name: 'Berlin', post: '10', area: '30' },
      { name: 'Hamburg', post: '20', area: '40' },
      { name: 'Nordrhein-Westfalen', post: '50', area: '221' },
      { name: 'Hessen', post: '60', area: '69' },
      { name: 'Baden-Wurttemberg', post: '70', area: '711' },
    ],
    zip: (seed, region) => `${region.post}${String(100 + (seed % 900)).padStart(3, '0')}`,
    phone: (seed, region) => {
      const n = 1000000 + (seed % 9000000);
      return `+49 ${region.area} ${String(n).padStart(7, '0')}`;
    },
    emailDomains: ['gmail.com', 'web.de', 'gmx.de', 'outlook.com'],
  },
  FR: {
    country: 'FR',
    given: ['Lucas', 'Camille', 'Hugo', 'Lea', 'Louis', 'Chloe', 'Gabriel', 'Manon', 'Jules', 'Emma', 'Raphael', 'Sarah', 'Arthur', 'Ines', 'Theo', 'Jade', 'Nathan', 'Louise', 'Ethan', 'Alice', 'Tom', 'Lina', 'Noah', 'Rose', 'Enzo', 'Anna', 'Mathis', 'Julia', 'Sacha', 'Eva', 'Adam', 'Zoe'],
    family: ['Martin', 'Bernard', 'Dubois', 'Thomas', 'Robert', 'Richard', 'Petit', 'Durand', 'Leroy', 'Moreau', 'Simon', 'Laurent', 'Lefebvre', 'Michel', 'Garcia', 'David', 'Bertrand', 'Roux', 'Vincent', 'Fournier', 'Morel', 'Girard', 'Andre', 'Mercier', 'Blanc', 'Guerin', 'Boyen', 'Garnier', 'Chevalier', 'Francois', 'Legrand', 'Gauthier'],
    streets: ['Rue de la Paix', 'Rue Victor Hugo', 'Avenue des Champs', 'Rue du Commerce', 'Boulevard Saint-Michel', 'Rue Nationale', 'Avenue de la Republique', 'Rue Pasteur'],
    cities: ['Paris', 'Lyon', 'Marseille', 'Toulouse', 'Bordeaux', 'Nantes'],
    regions: [
      { name: 'Ile-de-France', post: '75', area: '1' },
      { name: 'Auvergne-Rhone-Alpes', post: '69', area: '4' },
      { name: 'Provence-Alpes-Cote d\u2019Azur', post: '13', area: '6' },
      { name: 'Occitanie', post: '31', area: '5' },
      { name: 'Nouvelle-Aquitaine', post: '33', area: '5' },
      { name: 'Pays de la Loire', post: '44', area: '2' },
    ],
    zip: (seed, region) => `${region.post}${String(100 + (seed % 900)).padStart(3, '0')}`,
    phone: (seed, region) => {
      const n = 1000000 + (seed % 9000000);
      return `+33 ${region.area} ${String(n).padStart(7, '0')}`;
    },
    emailDomains: ['gmail.com', 'outlook.fr', 'orange.fr', 'proton.me'],
  },
};

/** Domain-separated deterministic sub-seed, exactly like deriveMotorSeed. */
function personaSubSeed(profileSeed: number, domain: string): number {
  const safeSeed = Math.max(MIN_SEED, Math.min(MAX_SEED, profileSeed >>> 0 || 1));
  const hmac = crypto.createHmac('sha256', HMAC_SECRET);
  hmac.update(`${safeSeed}:persona:${domain}`);
  const raw = hmac.digest().readUInt32BE(0);
  return (raw & 0x7fffffff) >>> 0;
}

function pick<T>(seed: number, arr: readonly T[]): T {
  return arr[seed % arr.length];
}

/** Standard Luhn check digit for a partial PAN (append to complete the number). */
export function luhnCheckDigit(partial: string): number {
  const digits = partial.split('').map(Number);
  let sum = 0;
  let double = true;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits[i];
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return (10 - (sum % 10)) % 10;
}

/** True when the number satisfies the Luhn check. */
export function passesLuhn(number: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = number.length - 1; i >= 0; i--) {
    let d = Number(number[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * Deterministic coherent persona for a profile seed. Same seed -> same person,
 * forever; different seeds -> different (name, address, email, phone, card).
 */
export function generatePersona(profileSeed: number, opts: PersonaOptions = {}): Persona {
  const now = opts.now ?? Date.now();
  const requested = String(opts.country ?? 'US').toUpperCase();
  const locale = LOCALES[requested as PersonaCountry] ?? LOCALES.US;

  const given = pick(personaSubSeed(profileSeed, 'given'), locale.given);
  const family = pick(personaSubSeed(profileSeed, 'family'), locale.family);

  // Email local part derives from the name.
  const base = `${given}.${family}`.toLowerCase().replace(/[^a-z0-9]/g, '');
  const suffixSeed = personaSubSeed(profileSeed, 'email-suffix');
  const localPart = suffixSeed % 4 === 0 ? `${base}${String(100 + (suffixSeed % 900))}` : base;
  const email = `${localPart}@${pick(personaSubSeed(profileSeed, 'email-domain'), locale.emailDomains)}`;

  const regionIdx = personaSubSeed(profileSeed, 'region') % locale.regions.length;
  const region = locale.regions[regionIdx];
  const city = pick(personaSubSeed(profileSeed, 'city'), locale.cities);
  const house = 1 + (personaSubSeed(profileSeed, 'house') % 999);
  const address = `${house} ${pick(personaSubSeed(profileSeed, 'street'), locale.streets)}`;
  const postcode = locale.zip(personaSubSeed(profileSeed, 'zip'), region);
  const phone = locale.phone(personaSubSeed(profileSeed, 'phone'), region);

  // Date of birth: adult (21-58) on the persona clock.
  const nowDate = new Date(now);
  const age = 21 + (personaSubSeed(profileSeed, 'age') % 38);
  const birthYear = nowDate.getFullYear() - age;
  const birthMonth = 1 + (personaSubSeed(profileSeed, 'birth-month') % 12);
  const birthDay = 1 + (personaSubSeed(profileSeed, 'birth-day') % 28);
  const dateOfBirth = `${birthYear}-${String(birthMonth).padStart(2, '0')}-${String(birthDay).padStart(2, '0')}`;

  // Card: 15-digit prefix (Visa '4' or Mastercard '5') + Luhn check digit.
  const brand = personaSubSeed(profileSeed, 'card-brand') % 2 === 0 ? '4' : '5';
  let partial = brand;
  for (let i = 0; i < 14; i++) {
    partial += String((personaSubSeed(profileSeed, `card-digit-${i}`) % 10));
  }
  const number = `${partial}${luhnCheckDigit(partial)}`;

  const expMonth = 1 + (personaSubSeed(profileSeed, 'exp-month') % 12);
  const expYearOffset = 1 + (personaSubSeed(profileSeed, 'exp-year') % 5);
  const expYearShort = ((nowDate.getFullYear() + expYearOffset) % 100);
  const expiry = `${String(expMonth).padStart(2, '0')}/${String(expYearShort).padStart(2, '0')}`;
  const cvv = String(100 + (personaSubSeed(profileSeed, 'cvv') % 900));

  return {
    givenName: given,
    familyName: family,
    fullName: `${given} ${family}`,
    address,
    city,
    region: region.name,
    postcode,
    country: locale.country,
    phone,
    email,
    dateOfBirth,
    card: { number, expiry, cvv },
  };
}

/** Resolve a dotted persona field name to its value ('card.number' etc.). */
export function personaFieldValue(persona: Persona, field: string): string | undefined {
  if (field === 'card.number') return persona.card.number;
  if (field === 'card.expiry') return persona.card.expiry;
  if (field === 'card.cvv') return persona.card.cvv;
  return (persona as unknown as Record<string, unknown>)[field] as string | undefined;
}
