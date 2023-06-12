import { NhostClient } from "@nhost/nhost-js"
import { expect, it, beforeAll } from "vitest"
import bcrypt from "bcrypt"
import { waitFor } from "xstate/lib/waitFor"

// Test user data
const EMAIL = "alice@example.com"
const PASSWORD = "password123"

beforeAll(async () => {
  // Create a test user in the database
  const adminNhost = new NhostClient({
    adminSecret: "nhost-admin-secret",
    subdomain: "local",
    region: "",
  })
  const passwordSalt = await bcrypt.genSalt(10)
  const passwordHash = await bcrypt.hash(PASSWORD, passwordSalt)
  const createTestUser = await adminNhost.graphql.request(
    /* GraphQL */ `
      mutation NewUser($email: citext!, $passwordHash: String!) {
        insertUser(
          object: {
            email: $email
            emailVerified: true
            locale: "en"
            passwordHash: $passwordHash
          }
          on_conflict: {
            constraint: users_email_key
            update_columns: emailVerified
          }
        ) {
          id
          email
        }
      }
    `,
    { email: EMAIL, passwordHash }
  )

  expect(createTestUser.error).toBeNull()
})

it("works without initial session", async () => {
  const nhost = new NhostClient({
    subdomain: "local",
  })

  const signin = await nhost.auth.signIn({
    email: EMAIL,
    password: PASSWORD,
  })

  expect(signin.error).toBeNull()
  expect(nhost.auth.getSession()).not.toBeNull()
  expect(nhost.auth.getAccessToken()).not.toBeNull()

  const signout = await nhost.auth.signOut()

  expect(signout.error).toBeNull()
  expect(nhost.auth.getSession()).toBeNull()
  expect(nhost.auth.getAccessToken()).toBeUndefined()
})

it("does not signout correctly with initial session", async () => {
  // Generate initial session in first request
  let nhost = new NhostClient({
    subdomain: "local",
  })

  const { session, error: signInError } = await nhost.auth.signIn({
    email: EMAIL,
    password: PASSWORD,
  })
  expect(signInError).toBeNull()

  // Reuse the session in a second request.
  // This is the behavior for a server-side Nhost instance
  // Code inspired from the next-js integration
  // https://github.com/nhost/nhost/blob/main/packages/nextjs/src/create-server-side-client.ts
  nhost = new NhostClient({
    subdomain: "local",
    start: false,
  })

  nhost.auth.client.start({ initialSession: session })

  await waitFor(
    nhost.auth.client.interpreter,
    (state) => !state.hasTag("loading")
  )

  expect(nhost.auth.isAuthenticated()).toBe(true)

  const signout = await nhost.auth.signOut()
  expect(signout.error).toBeNull() // OK
  expect(nhost.auth.getSession()).toBeNull() // OK

  expect(nhost.auth.getAccessToken()).toBeUndefined() // Not OK
})
