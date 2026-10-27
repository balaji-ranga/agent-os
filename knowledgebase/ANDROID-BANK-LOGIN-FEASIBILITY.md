# Android bank login and bridge feasibility

Date: 2026-10-26. Scope: Standard Chartered SC Mobile Singapore and DBS digibank Singapore on stock Android. Evidence: public platform and bank documentation; no bank binaries, customer devices or live account sessions were inspected.

## Finding

An Android bridge can coordinate a user-authenticated task and may execute a coached read-only route after login if the bank permits the interaction mechanism. It cannot obtain a bank's private Android Keystore keys through ordinary permissions, satisfy a biometric challenge itself, or convert a full banking session into a bank-enforced read-only session. Fully unattended SCB/DBS login is not established and must not be a launch promise.

There are four independent gates: valid bank authentication; permitted observation and navigation after authentication; distributable automation behavior; and Flolah's own authorization/data-residency controls. Passing one does not pass the others. Coaching solves route recognition, not credential authority or blocked observation.

## What login actually involves

A bank app may combine user ID/password or PIN, an enrolled device token, biometric-gated cryptographic operations, server risk evaluation, and additional challenges. Exact internal key use in SCB/DBS is not established by public UI documentation. Distinguish the Android screen-lock credential, the bank login credential, an app-specific token PIN and a remote approval: they are not interchangeable.

The bridge should launch the official app, pause credential capture and actions at the authentication boundary, let the bank and Android handle the user's authentication, then recognize a permitted authenticated landing state. A successful Flolah biometric prompt proves presence to Flolah; it does not hand Flolah a bank session or permission to use bank keys. Never assume unlocking the phone logs into either bank. Android permits different key authentication policies; only the key-owning app and its server determine sufficiency. [Android biometric authentication](https://developer.android.com/identity/sign-in/biometric-auth), [AOSP authentication](https://source.android.com/docs/security/features/authentication).

If a valid bank session already exists, the bridge can potentially use its exposed UI for the remaining session lifetime. Session reuse is opportunistic, not a durable unattended-login mechanism. Do not keep sessions alive to defeat timeout or copy tokens out of app storage.

## Access levels

- **Ordinary companion:** scoped app discovery/launch and Flolah's own storage/networking. No general cross-app UI control and no bank-private files or keys. Foreground launch remains subject to Android background-start rules.
- **User-enabled AccessibilityService:** can observe exposed accessibility nodes and perform supported actions/gestures, depending on configuration and protected controls. This is broad technical access, not an OS-enforced read-only bank grant. It does not expose bank Keystore keys. Bank security checks may reject the service or app configuration.
- **MediaProjection:** user-authorized screen capture, not input injection, token access or secure-screen access. Avoid it as the bank pilot's default: both banks document restrictions on screen sharing/mirroring. Local processing does not prevent detection of a capture mechanism.
- **Autofill provider/password manager:** potentially fills credentials intentionally stored in that provider when the bank's fields support it and the user authorizes the flow. It does not read another password manager's vault or the bank's private keys. Prefer the user's existing manager over building a Flolah bank-credential vault. [Android Autofill services](https://developer.android.com/identity/autofill/autofill-services).
- **ADB/UI Automator/Appium harness:** useful for controlled compatibility tests and visible UI interaction under instrumentation/shell setup. Not a normal consumer-app permission and not proof of an installable production bridge. It does not normally grant private bank app data/keys or genuine biometric success. [UI Automator](https://developer.android.com/training/testing/other-components/ui-automator-legacy).
- **Enterprise device/profile owner:** useful for enrollment, app policy and certain certificate/key provisioning. It is not blanket authority to decrypt bank storage or access bank-owned AndroidKeyStore entries. Do not confuse enterprise KeyChain grants with another app's private key namespace. [DevicePolicyManager KeyChain grants](https://developer.android.com/reference/android/app/admin/DevicePolicyManager#grantKeyPairToApp(android.content.ComponentName,java.lang.String,java.lang.String)).
- **OEM/system privilege or root:** changes the threat model, requires platform cooperation or compromises, may trigger bank refusal, and does not imply hardware key export or bypass of server challenges. Excluded as a customer solution. Even privileged deployment would need bank/platform support rather than a claimed universal permission.

No combination of ordinary storage, notification, overlay, Accessibility or biometric permission is an Android permission named "access other app's bank Keystore." [Android app sandbox](https://source.android.com/docs/security/app-sandbox).

## Keystore design

Android Keystore is a cryptographic service with ownership and use restrictions, not a shared folder of readable passwords. Apps normally use their own UID-bound key namespace. A bank's alias is not sufficient authority for Flolah to retrieve or operate its key. Android supports explicitly controlled sharing mechanisms, but Flolah cannot grant itself bank-key access. Hardware-backed keys may be bound to TEE or StrongBox and configured for user authentication. Protected key material is not returned as raw bytes; invoking a permitted operation is different from exporting a key. [Keystore namespaces](https://source.android.com/docs/security/features/keystore), [Android Keystore](https://developer.android.com/privacy-and-security/keystore).

For Flolah's own keys, use the AndroidKeyStore provider via KeyStore.getInstance("AndroidKeyStore") and load(null), generate keys with KeyGenerator/KeyPairGenerator and KeyGenParameterSpec, and invoke cryptographic operations with the resulting handles. No special runtime permission grants these own-app operations or cross-app access. Confirm hardware security level with KeyInfo; StrongBox is optional and capability dependent. This describes Flolah key use only, never bank-key acquisition.

Use distinct policies for a device identity/signing key and a local result encryption key. User-gating the transport identity on every use would prevent unattended progress/heartbeats; user-gating sensitive result access is a separate design decision. Store encrypted bulk data in app-private files, not inside Keystore. Handle key invalidation, device reset, backup exclusion and re-pairing. Bank token enrollment remains inside the bank app. User consent to Flolah cannot reconfigure an existing bank-owned key or its authentication policy.

Credential Manager does not let an unrelated app request bank passkeys as its own credentials. Associated app/site credential sharing requires the relevant identity association; Flolah cannot establish bank-side trust unilaterally. [Credential Manager prerequisites](https://developer.android.com/identity/credential-manager/prerequisites).

## SCB and DBS constraints

DBS explicitly documents restricted access for certain non-official-store apps with Accessibility enabled, known malware/rooted devices, and active screen sharing/mirroring. This does not prove all Accessibility services are blocked or that official-store publication guarantees acceptance. SCB independently documents risky Accessibility-enabled apps from untrusted stores and screen-sharing/mirroring restrictions. These are material obstacles to a sideloaded bridge prototype on customer banking phones. [DBS restrictions](https://www.dbs.com.sg/personal/support/general-digibank-security-malware-jailbroken-device.html), [SCB malware protection](https://www.sc.com/sg/fraud-scam/malware/).

SCB's dedicated single-device notice specifies registered SC Mobile Key and transfer/re-registration on device change for version 9.14.9 and above. Its general mobile FAQ also contains broader multi-device language. Treat this as a public-documentation discrepancy; use the actual installed version and bank confirmation for pilot enrollment. Do not move a customer's token to an automation device or emulator as an onboarding shortcut. [SCB single-device notice](https://www.sc.com/sg/important-information/single-device-login-for-sc-mobile/), [SCB mobile FAQ](https://www.sc.com/sg/bank-with-us/mobile-banking-services/standard-chartered-mobile/).

DBS describes mobile digital-token registration and separately requires digital-token approval for applicable online banking logins. Browser automation therefore does not eliminate mobile authentication. An online-login policy must not be applied indiscriminately to mobile login. [DBS login authentication](https://www.dbs.com.sg/personal/support/general-digibank-security-login-authentication.html).

FLAG_SECURE blocks relevant screenshots/non-secure displays, while accessibility-sensitive views can restrict another observation channel. They are different controls: a screenshot block alone does not prove every accessibility node is hidden, and readable nodes do not prove screenshots work. Validate card-summary and statement screens independently, including after login. [Secure activities](https://developer.android.com/security/fraud-prevention/activities), [Android sensitive accessibility data](https://developer.android.com/blog/posts/enhancing-android-security-stop-malware-from-snooping-on-your-app-data).

## Distribution and LLM boundary

Google Play explicitly permits a distinction for static, human-defined deterministic scripts while prohibiting Accessibility automation that autonomously initiates, plans and executes decisions. Thus a user-selected, reviewed coached route has a more plausible distribution path than an LLM navigating arbitrary screens. That is an architectural inference, not approval or a guarantee that selecting a recipe via an LLM is compliant. A remote planner does not avoid policy merely because execution is local. Obtain a policy determination for the exact behavior; do not label Flolah an accessibility tool unless disability assistance genuinely meets that definition. [Accessibility policy](https://support.google.com/googleplay/android-developer/answer/10964491).

For the initial bank route: the user initiates a named task, Flolah selects/proposes a fixed release, the user confirms its scope, and the local engine follows only taught transitions. LLM screen improvisation, automated token approval and credential capture remain disabled. If the bank rejects the bridge, stop and record unsupported rather than attempting to hide permissions or defeat detection.

## Proposed login state machine

```text
USER_START -> DEVICE_READY -> BANK_OPEN
  -> AUTH_REQUIRED -> HUMAN_AUTHENTICATING
  -> VERIFY_AUTHENTICATED_SCREEN -> RUN_READ_ONLY_RECIPE
  -> LOCAL_RESULT -> END

Any point -> BANK_SECURITY_BLOCK / PROTECTED_SCREEN / UNKNOWN_STATE -> STOP
Session expiry -> AUTH_REQUIRED (human handoff; no blind credential retries)
```

During authentication do not capture screenshots, hierarchies, keystrokes, clipboard, OTP notifications or approval actions. Resuming after a handoff requires verifying permitted UI state; the user's "done" button alone is not proof of login. Some service configurations are themselves blocked regardless of a logical pause; real compatibility testing must determine whether the route remains possible. If access requires disabling the only usable navigation mechanism, post-login automation has not passed.

Server events are limited to states such as AUTH_REQUIRED, HUMAN_COMPLETED, VERIFIED_HOME and SECURITY_BLOCKED plus scoped task IDs. A financial result remains local under private mode. Authentication handoff does not permit uploading raw auth or account screens.

## Feasibility verdict and pilot experiment

**Attended orchestration:** feasible as a design, with human bank authentication. **Automated post-login retrieval:** conditional and unproven for both apps. **Password autofill:** technically possible in Android where supported; SCB/DBS field compatibility and resulting bank acceptance are unverified. **Flolah access to bank-private keys:** no supported unilateral path. **Guaranteed unattended login and token approval:** not an established supported capability. **Bank-delegated read API:** strongest potential route for unattended read-only operation if the bank offers the exact required fields/scopes and grants access; neither availability nor customer entitlement is assumed here.

Run on consenting users' stock physical phones, using existing bank enrollment and no token migration:

1. Record Android/device/app versions, package signing identity and install source; establish baseline manual login without Flolah mechanisms active.
2. Test companion launch and human login with no capture/control service. Verify bank access remains normal.
3. Separately test the proposed permissible observation/control mechanism, its foreground state and bank behavior; do not enable several mechanisms at once and attribute failure to the wrong one.
4. Check exposed non-authentication elements on home, cards and bill-details screens. Mark security blocks, protected values and ambiguous selectors; retain minimal sanitized evidence locally.
5. Run the exact coached read-only task, human authentication, multi-card extraction and local comparison with source values. Test timeout, locked device, cancellation and app switching. Stop login retries on failure to avoid lockout.
6. Confirm no credentials, auth screenshots or financial values reach server logs/model calls. Validate the actual installation/distribution path and bank acceptance, not just a debugging harness.

Record separate pass/fail for login handoff, post-login observation, navigation, field accuracy, distribution and privacy. Passing a lab UI script alone cannot publish the production bank recipe. If either bank blocks required mechanisms, keep its recipe ineligible and pursue a supported integration or explicitly separate statement-import flow.

## Changes required before implementation

Keep the existing device-local core objective. Add per-release auth mode, user-presence requirement, supported interaction backend, install-source assumptions, protected-screen behavior, session-expiry handling and measured bank compatibility to recipe metadata. Advertise the pilot as user-authenticated read-only assistance until real-device evidence supports more. Do not schedule unattended bank retrieval against these recipes. The architecture should support delegated provider authorization later without making direct bank-key access a dependency.
