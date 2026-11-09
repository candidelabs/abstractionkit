// Compile-time checks for SafeAccountV0_2_0.initializeNewAccount: a call on a
// class returns that class's instance type, and a detached call type-checks
// and returns SafeAccountV0_2_0 (matching the runtime fallback).
import { SafeAccountV0_2_0 } from "../../src/index";

const address = "0x0000000000000000000000000000000000000001" as const;

class CustomSafe extends SafeAccountV0_2_0 {
	readonly tag = "custom";
}

const base: SafeAccountV0_2_0 = SafeAccountV0_2_0.initializeNewAccount([address]);
const custom: CustomSafe = CustomSafe.initializeNewAccount([address], { threshold: 1 });
const tag: "custom" = custom.tag;

const init = SafeAccountV0_2_0.initializeNewAccount;
const detached: SafeAccountV0_2_0 = init([address]);

void base;
void tag;
void detached;
