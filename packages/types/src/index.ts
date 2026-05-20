// @nvy/types — cross-package shared type re-exports for the no-vain-years mono.
//
// Per spec 002-account-profile plan D11, this entry will re-export
// Prisma-generated model + enum types (Account, account_status_enum, ...)
// so mobile / packages/auth can import them without reaching into apps/server.
//
// T002 bootstrap skeleton — actual @prisma/client re-exports land in a
// follow-up task once the `display_name` column migration + prisma generate
// refresh is in place.

export {};
