# Security Specification & Payload-First TDD — SPLENDORA CINEMA

## 1. Data Invariants
1. **Default-Deny Safety Net**: All unmatched Firestore paths deny read and write (`match /{document=**} { allow read, write: if false; }`).
2. **Verified Identity**: All authenticated writes require `request.auth != null && request.auth.token.email_verified == true`.
3. **Strict Admin Governance**: Only `mypersonaluse2013@gmail.com` (verified email) or an active email entry in `/admins/{email}` grants `isAdmin()`. Normal customers can never read or write `/admins`, `/paymentSettings/private`, `/tickets/{id}/security`, `/auditLogs`, or `/refunds`.
4. **Booking & Payment Integrity**: Customers may only create bookings for themselves (`customerId == request.auth.uid`) with `paymentStatus` in `['PENDING', 'PENDING_VERIFICATION']` and `bookingStatus` in `['HOLD', 'PENDING_VERIFICATION']`. Customers can NEVER set `paymentStatus: 'VERIFIED'`, `bookingStatus: 'CONFIRMED'`, or create/modify `/tickets`.
5. **Independent Seat Protection**: Customers may only place temporary `HELD` or `RESERVED` holds on `AVAILABLE` (or expired `HELD`) seats, and can never set `BOOKED` or `BLOCKED`, nor overwrite another user's active hold/booking.
6. **PII Isolation & Query Enforcement**: `/users/{uid}`, `/bookings`, `/payments`, `/tickets`, `/mocktailOrders`, and `/mocktailAssignments` restrict `get` and `list` to `resource.data.customerId == request.auth.uid || isAdmin()`.
7. **Ticket Check-In Atomicity**: `/tickets/{ticketId}` and `/tickets/{ticketId}/security/{secId}` can only be created or updated by `isAdmin()`, preventing forged `VALID` or duplicate `USED` transitions.
8. **Immutable Audit Trail**: `/auditLogs` cannot be updated or deleted once created; `/bookings` and `/payments` cannot be deleted.

## 2. The "Dirty Dozen" Attack Payloads
1. **Unverified Admin Spoof**: Token with `email: "mypersonaluse2013@gmail.com"` and `email_verified: false` attempting to read `/admins` or write `/movies/apne-beech`. -> `PERMISSION_DENIED`.
2. **Self-Promotion to Admin**: Authenticated customer attempting to create `/admins/attacker@gmail.com` with `role: "SUPER_ADMIN"`. -> `PERMISSION_DENIED`.
3. **Customer Self-Verifying Payment**: Customer creating `/bookings/SC999` with `paymentStatus: "VERIFIED"` and `bookingStatus: "CONFIRMED"`. -> `PERMISSION_DENIED`.
4. **Customer Forging Ticket**: Customer attempting to write `/tickets/TKT999` with `ticketStatus: "VALID"`. -> `PERMISSION_DENIED`.
5. **Shadow Ghost Field Injection**: Customer creating `/bookings/SC999` with extra field `isComplimentary: true`. -> `PERMISSION_DENIED`.
6. **Seat Hijack / Double Booking**: Customer B attempting to overwrite seat `SCR_20261225_01_A1` currently `HELD` (unexpired) or `BOOKED` by Customer A. -> `PERMISSION_DENIED`.
7. **Customer Marking Seat Booked**: Customer attempting to update seat status directly to `"BOOKED"`. -> `PERMISSION_DENIED`.
8. **Cross-Customer Booking Read (PII Leak)**: Customer B attempting `get` or `list` on `/bookings` where `customerId == Customer A`. -> `PERMISSION_DENIED`.
9. **Payment Secrets Exposure**: Customer attempting to read `/paymentSettings/private` containing gateway secrets. -> `PERMISSION_DENIED`.
10. **Ticket Security Hash Tampering**: Customer attempting to read `/tickets/TKT1001/security/hash`. -> `PERMISSION_DENIED`.
11. **Path Variable Poisoning**: Request targeting `/bookings/invalid$id!with*badchars` or >128 chars. -> `PERMISSION_DENIED`.
12. **Client Timestamp Tampering / Audit Deletion**: User creating a booking with backdated `createdAt` (`!= request.time`) or deleting an `/auditLogs` entry. -> `PERMISSION_DENIED`.
