/**
 * Security Rules Specification Verification (Phase 0 TDD)
 * Validates Dirty Dozen attack vectors against firestore.rules logic invariants.
 */
import fs from 'fs';
import assert from 'assert';

const rules = fs.readFileSync('firestore.rules', 'utf8');

// Verify Critical Security Gates are present in production rules
const assertions: Array<{ name: string; check: boolean }> = [
  { name: 'Default-deny catch-all rule present', check: rules.includes('match /{document=**}') && rules.includes('allow read, write: if false;') },
  { name: 'Email verification required for bootstrap admin', check: rules.includes('request.auth.token.email_verified == true') && rules.includes('mypersonaluse2013@gmail.com') },
  { name: 'Admin collection write restricted to isAdmin()', check: /match \/admins\/\{adminEmail\}[\s\S]*allow create: if[\s\S]*isAdmin\(\)/.test(rules) },
  { name: 'Bookings reject VERIFIED/CONFIRMED from non-admins on create', check: rules.includes("incoming().paymentStatus in ['PENDING', 'PENDING_VERIFICATION']") && rules.includes("incoming().bookingStatus in ['HOLD', 'PENDING_VERIFICATION']") },
  { name: 'Bookings forbid deletion', check: /match \/bookings\/\{bookingId\}[\s\S]*allow delete: if false;/.test(rules) },
  { name: 'Tickets restrict create/update to isAdmin()', check: /match \/tickets\/\{ticketId\}[\s\S]*allow create: if[\s\S]*isAdmin\(\)[\s\S]*allow update: if[\s\S]*isAdmin\(\)/.test(rules) },
  { name: 'Ticket security hashes strictly admin-only', check: /match \/security\/\{secId\}[\s\S]*allow get: if[\s\S]*isAdmin\(\)/.test(rules) },
  { name: 'Private payment settings strictly admin-only', check: /match \/paymentSettings\/\{settingId\}[\s\S]*settingId == 'private' && (isAdmin\(\)|hasAdminFeature\('managePaymentSettings'\))/.test(rules) },
  { name: 'Audit logs are immutable (no update/delete)', check: /match \/auditLogs\/\{logId\}[\s\S]*allow update: if false;[\s\S]*allow delete: if false;/.test(rules) },
  { name: 'List queries enforce owner UID before admin fallback', check: rules.includes('resource.data.customerId == request.auth.uid') },
  { name: 'Path variable ID hardening present', check: rules.includes('function isValidId(id)') },
  { name: 'Server timestamp enforcement present', check: rules.includes('request.time') },
  { name: 'Row prices map validation present on screenings', check: rules.includes('function isValidRowPrices(rp)') },
  { name: 'Customers cannot spoof discounts or complimentary drinks on create', check: rules.includes("incoming().discountAmount == 0") && rules.includes("incoming().complimentaryDrinks == false") },
  { name: 'Primary owner account protected from downgrade or deletion', check: rules.includes("adminEmail != 'mypersonaluse2013@gmail.com'") },
];

for (const a of assertions) {
  assert.strictEqual(a.check, true, `Security invariant failed: ${a.name}`);
}

console.log(`All ${assertions.length} Firestore security invariants verified.`);
