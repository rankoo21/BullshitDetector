/* Public demo config.
 *
 * Deploy studio_contracts/bullshit_detector.py ONCE, paste the address
 * here, and every visitor shares the same on-chain feed of verdicts.
 */
export const DEFAULTS = {
  network: "studionet",
  contract: "0xa99B32CC23189e3DE78343F96840097dcC27a081",  // <-- paste the deployed BullshitDetector address here
  autoSwitchNetwork: true,
};
