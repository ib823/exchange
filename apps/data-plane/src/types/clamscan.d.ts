// Ambient module declaration for `clamscan`.
//
// clamscan@2.x does not ship its own TypeScript types and there is no
// maintained @types/clamscan on DefinitelyTyped. We install the package in
// M3.0 §6.2 as a forward-wire dep; the runtime import (in __smoke__.test.ts)
// just needs to resolve.
//
// When M3 actually wires the malware-scan pipeline (per plan §1 "ClamAV
// malware scan — wired in M3"), replace this with a proper types definition
// authored against the specific ClamScan class / option surface we consume.
// Tracking: M3 malware-scan wiring ticket.
declare module 'clamscan';
