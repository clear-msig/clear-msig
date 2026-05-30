# ClearSig Investor Q&A

Use these as concise answers. Keep the tone direct, technical, and honest.

## Product And Vision

1. **What is ClearSig?**  
   ClearSig is a clear-signing multisig that lets teams approve readable transaction intents instead of blind hex, then execute native transactions across chains from one shared wallet workflow.

2. **What problem are you solving?**  
   Multisig users often sign transactions they cannot read. ClearSig makes the approval message human-readable, policy-bound, and verifiable before execution.

3. **Who is the target customer?**  
   Crypto teams, funds, DAOs, startups, and high-value individuals who need safer treasury controls across multiple chains.

4. **Why does this matter now?**  
   More teams operate across several chains, but their signing workflows are fragmented, technical, and risky. ClearSig gives them one safer control layer.

5. **What is the core insight behind ClearSig?**  
   Users should approve intent, not opaque calldata. The same readable intent should drive policy verification and final chain-native execution.

6. **What makes ClearSig different from a normal multisig?**  
   Traditional multisigs usually secure one chain. ClearSig uses Solana-based policy plus dWallet signing to control native assets across multiple chains.

7. **Is ClearSig a bridge?**  
   No. ClearSig does not wrap assets or move assets through a bridge. The dWallet public key is the native address on the destination chain.

8. **What chains are supported?**  
   The current architecture supports Solana, EVM/Ethereum-style chains, Bitcoin P2WPKH, Zcash transparent addresses, and other chains that Ika can support.

9. **What is the user experience?**  
   A user creates a wallet, adds members and thresholds, binds chains, proposes an action, gets approvals, and executes once the threshold is met.

10. **What is the product promise in one sentence?**  
   ClearSig lets teams safely approve readable cross-chain treasury actions from one multisig.

## Technical Architecture

11. **How does ClearSig work technically?**  
   Solana stores wallet policy, intents, proposals, approvals, and execution state. Chain-specific adapters build the native transaction preimage, and Ika signs for the destination chain.

12. **Why use Solana for the policy layer?**  
   Solana gives fast, cheap, programmable on-chain state for wallet rules, proposals, thresholds, and approval tracking.

13. **What is an intent?**  
   An intent is a reusable transaction blueprint. It defines the chain, parameters, readable template, proposers, approvers, threshold, and execution data.

14. **What is a proposal?**  
   A proposal is a filled-in instance of an intent. It moves through creation, approval collection, optional cancellation, and execution.

15. **How do approvals work?**  
   Approvers sign a readable message tied to the wallet, proposal, expiry, and parameters. The Solana program verifies the signatures and tracks threshold state.

16. **How do you prevent direct execution before approvals?**  
   Execution is gated by proposal status and threshold approval. A proposal must be approved before the execution path can complete.

17. **How does ClearSig know which chain to send on?**  
   Every intent has an explicit chain kind. The send flow selects the approved intent for that chain and uses the matching chain adapter.

18. **How does EVM execution work?**  
   ClearSig builds an EIP-1559 transaction preimage, verifies the multisig approval path, obtains the dWallet signature, assembles the native transaction, and broadcasts it.

19. **How does Bitcoin execution work?**  
   ClearSig builds the Bitcoin spend preimage for the configured UTXO path, uses dWallet ECDSA signing, assembles the transaction, and broadcasts it natively.

20. **How does Solana execution work?**  
   ClearSig uses a Solana chain adapter, including durable nonce handling for SOL transfers, then executes only after the proposal is approved.

21. **What is Ika's role?**  
   Ika provides dWallet signing, so the same policy layer can authorize native signatures for non-Solana chains.

22. **Does ClearSig custody user funds?**  
   The goal is non-custodial control through multisig policy and dWallet addresses. ClearSig coordinates approvals and signing; it should not be a centralized custodian.

23. **Where does the backend fit?**  
   The backend is an HTTP adapter around the Rust CLI. It keeps the frontend simple and avoids duplicating transaction assembly logic in TypeScript.

24. **Why keep a CLI?**  
   The CLI is the reliable execution engine. It owns instruction assembly, chain adapters, preimage logic, and broadcasting.

25. **What is stored on-chain?**  
   Wallets, intents, proposals, approval state, cancellation state, chain bindings, and dWallet ownership metadata.

26. **What is stored locally in the app?**  
   UX data like contacts, watched wallets, and some security preferences can be local. Critical approval and execution state lives on-chain.

27. **How do you handle replay protection?**  
   Signed messages include proposal identity, wallet context, expiry, and proposal index. Reusing the same signature against a different proposal should fail.

28. **How do you handle expired approvals?**  
   Approval messages include an expiry. The program and signing flow treat stale messages as invalid.

29. **How do you handle hardware wallets?**  
   Ledger support exists for Solana off-chain message signing, so users can read the approval message on the device screen.

30. **How do software wallets fit in?**  
   Software wallets sign the approval message, while the app rebuilds and verifies the signable bytes locally before opening the wallet prompt.

## Security And Risk

31. **What is your biggest security advantage?**  
   Users approve readable intent, not blind bytes. That reduces the chance of signing a transaction they do not understand.

32. **How do you defend against backend message substitution?**  
   The frontend rebuilds the signable message from on-chain intent data and compares it against the backend descriptor before asking the wallet to sign.

33. **What is the strongest signing path today?**  
   Ledger is the strongest path because the device can display the off-chain approval message directly to the user.

34. **What security risks remain?**  
   The project is pre-alpha. Ika integration, encrypted policy enforcement, audits, and production hardening still need to mature before real funds.

35. **Is encrypted policy live today?**  
   Not fully. The frontend has Encrypt pre-alpha plumbing, but on-chain FHE policy enforcement is not production-live yet.

36. **How do you handle malicious contacts or address swaps?**  
   The app shows the destination address in the sign preview and uses local integrity checks for contacts, but users still need to verify high-value sends.

37. **What prevents one member from changing the rules?**  
   Wallet rule changes are themselves intents, so they require the configured approval threshold.

38. **What happens if the threshold is one?**  
   A threshold-one wallet behaves like a solo wallet. It is simpler, but it does not give the same protection as multi-approver control.

39. **What is your audit status?**  
   Today this is pre-alpha and should not be represented as audited production infrastructure. A formal audit is a required step before mainnet funds.

40. **How do you reduce phishing risk?**  
   ClearSig uses security pages, strict headers, same-origin checks, and clear signing previews. Long term, stronger identity and hardware-first flows matter.

## Competitive Position

41. **Why is ClearSig better than existing multisigs?**  
   ClearSig combines readable approvals, cross-chain native execution, and programmable intent policy in one workflow. Most multisigs are either single-chain or require users to inspect unreadable transaction data.

42. **How are you different from Safe?**  
   Safe is excellent for EVM, but ClearSig is designed as a cross-chain intent multisig, not just an EVM account abstraction wallet.

43. **How are you different from Squads?**  
   Squads is strong on Solana treasury management. ClearSig uses Solana as the policy layer while extending control to native assets on other chains.

44. **How are you different from Fireblocks or Copper?**  
   Those are institutional custody platforms. ClearSig is building a programmable, non-custodial, intent-based multisig experience that can be simpler and more transparent for teams.

45. **Why would a team choose ClearSig over separate wallets per chain?**  
   Separate wallets create fragmented approvals and inconsistent security. ClearSig gives one policy model across chains.

46. **Why would a user trust a newer multisig?**  
   We should earn trust gradually: pre-alpha, testnet usage, transparent security docs, audits, hardware signing, and conservative mainnet rollout.

47. **What is the key technical moat?**  
   The moat is the intent-policy layer plus chain-native dWallet execution. It is not just a frontend; it is a full signing and execution pipeline.

48. **Can competitors copy this?**  
   The idea can be copied, but reliable cross-chain signing, readable policy, chain adapters, UX, security, and operational trust take time to build well.

49. **Why now versus waiting for wallets to improve?**  
   Wallet UX is improving slowly, but teams need treasury-grade approvals now. ClearSig gives an application-level solution instead of waiting for every wallet and chain to standardize.

50. **What is the strongest one-line competitive answer?**  
   ClearSig is the multisig for teams that need to understand what they approve and execute it natively across chains.

## Business And Go-To-Market

51. **Who pays for ClearSig?**  
   Teams managing treasury operations: startups, DAOs, funds, protocol teams, and businesses accepting or moving crypto.

52. **What is the business model?**  
   A practical model is SaaS for advanced team controls, premium security features, transaction workflow automation, and enterprise support.

53. **What is the wedge market?**  
   Cross-chain teams that already use multisigs but are frustrated by blind signing, fragmented workflows, and manual approvals.

54. **How do you acquire users?**  
   Start with crypto teams, accelerators, DAOs, and founders who manage multi-chain treasuries. Use demos, security content, and integrations.

55. **What is the investor-grade traction story today?**  
   The product has a working pre-alpha architecture, live demo surface, CLI, backend, frontend, and chain adapters. The next milestone is hardening toward real-fund readiness.

56. **What milestones matter next?**  
   Mainnet readiness, audits, production Ika integration, reliable chain execution, better policy enforcement, enterprise onboarding, and paid pilot customers.

57. **What are the biggest risks?**  
   Security, dependency on Ika maturity, audit readiness, user trust, and competing against established multisig brands.

58. **How do you reduce those risks?**  
   Ship in stages, keep pre-alpha disclaimers honest, audit the critical paths, prioritize Ledger and threshold approvals, and start with limited pilot use cases.

59. **What is your long-term vision?**  
   ClearSig becomes the control layer for cross-chain treasury operations: readable approvals, programmable policies, and native execution everywhere.

60. **Why should an investor care?**  
   Crypto treasury security is still too hard. ClearSig targets a real pain point with a technically differentiated approach and a clear path to monetizable team workflows.

## Short Closing Answer

ClearSig is not trying to be another wallet UI. It is a clear-signing, intent-based multisig control layer for cross-chain teams. The reason it matters is simple: teams should know exactly what they are approving, enforce that approval on-chain, and execute natively across the chains where their assets actually live.
