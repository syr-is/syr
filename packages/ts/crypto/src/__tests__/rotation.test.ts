import { describe, it, expect } from "vitest";
import {
  createRotationStatement,
  verifyRotationStatement,
  verifyRotationChain,
  generateRootKeypair,
  generateDeviceKeypair,
  derivePublicKeyFromSeed,
  deriveDid,
} from "../index.js";
import type { Keypair, RotationStatement } from "../index.js";

/** Build a valid chain of `hops` rotations. Returns did, statements, keys root0..rootN. */
async function buildChain(
  hops: number,
): Promise<{ did: string; statements: RotationStatement[]; keys: Keypair[] }> {
  const genesis = await generateRootKeypair();
  const did = deriveDid(genesis.publicKey);
  const keys: Keypair[] = [genesis];
  const statements: RotationStatement[] = [];
  for (let i = 0; i < hops; i++) {
    const next = await generateRootKeypair();
    statements.push(
      await createRotationStatement(
        did,
        i + 1,
        next.publicKey,
        keys[i].privateKey,
      ),
    );
    keys.push(next);
  }
  return { did, statements, keys };
}

describe("rotation statements", () => {
  it("createRotationStatement + verifyRotationStatement roundtrip", async () => {
    const current = await generateRootKeypair();
    const newKey = await generateRootKeypair();
    const did = deriveDid(current.publicKey);

    const statement = await createRotationStatement(
      did,
      1,
      newKey.publicKey,
      current.privateKey,
    );

    expect(statement.did).toBe(did);
    expect(statement.seq).toBe(1);
    expect(statement.prevRoot).toMatch(/^z/);
    expect(statement.newRoot).toMatch(/^z/);
    expect(statement.rotatedAt).toBeTruthy();
    expect(statement.signature).toMatch(/^z/);

    const valid = await verifyRotationStatement(statement, current.publicKey);
    expect(valid).toBe(true);
  });

  it("fails verification with wrong public key", async () => {
    const current = await generateRootKeypair();
    const newKey = await generateRootKeypair();
    const wrong = await generateDeviceKeypair();
    const did = deriveDid(current.publicKey);

    const statement = await createRotationStatement(
      did,
      1,
      newKey.publicKey,
      current.privateKey,
    );

    const valid = await verifyRotationStatement(statement, wrong.publicKey);
    expect(valid).toBe(false);
  });

  it("fails verification with tampered statement", async () => {
    const current = await generateRootKeypair();
    const newKey = await generateRootKeypair();
    const did = deriveDid(current.publicKey);

    const statement = await createRotationStatement(
      did,
      1,
      newKey.publicKey,
      current.privateKey,
    );

    const tampered = { ...statement, seq: 2 };
    const valid = await verifyRotationStatement(tampered, current.publicKey);
    expect(valid).toBe(false);
  });
});

describe("rotation chain verification", () => {
  it("empty chain resolves to genesis key", async () => {
    const genesis = await generateRootKeypair();
    const did = deriveDid(genesis.publicKey);
    const current = await verifyRotationChain(did, []);
    expect(current).toEqual(genesis.publicKey);
  });

  it("verifies a chain of three rotations and returns the last newRoot key", async () => {
    const { did, statements, keys } = await buildChain(3);
    const current = await verifyRotationChain(did, statements);
    expect(current).toEqual(keys[keys.length - 1].publicKey);
  });

  it("rejects a seq gap", async () => {
    const { did, statements, keys } = await buildChain(1);
    const next = await generateRootKeypair();
    const gapped = await createRotationStatement(
      did,
      3,
      next.publicKey,
      keys[1].privateKey,
    );
    await expect(
      verifyRotationChain(did, [...statements, gapped]),
    ).rejects.toThrow(/expected seq 2/);
  });

  it("rejects a forked statement (prevRoot mismatch)", async () => {
    const { did, statements, keys } = await buildChain(2);
    // Fork off root1 at seq 3 instead of chaining from root2.
    const next = await generateRootKeypair();
    const fork = await createRotationStatement(
      did,
      3,
      next.publicKey,
      keys[1].privateKey,
    );
    await expect(
      verifyRotationChain(did, [...statements, fork]),
    ).rejects.toThrow(/prevRoot does not match prior newRoot/);
  });

  it("rejects first statement whose prevRoot is not the genesis key", async () => {
    const genesis = await generateRootKeypair();
    const did = deriveDid(genesis.publicKey);
    const other = await generateRootKeypair();
    const next = await generateRootKeypair();
    const statement = await createRotationStatement(
      did,
      1,
      next.publicKey,
      other.privateKey,
    );
    await expect(verifyRotationChain(did, [statement])).rejects.toThrow(
      /does not match the genesis key/,
    );
  });

  it("rejects cross-DID replay", async () => {
    const { statements } = await buildChain(1);
    const other = await generateRootKeypair();
    const otherDid = deriveDid(other.publicKey);
    await expect(verifyRotationChain(otherDid, statements)).rejects.toThrow(
      /DID does not match/,
    );
  });
});

describe("derivePublicKeyFromSeed", () => {
  it("derives the matching public key", async () => {
    const pair = await generateRootKeypair();
    expect(derivePublicKeyFromSeed(pair.privateKey)).toEqual(pair.publicKey);
  });
});
