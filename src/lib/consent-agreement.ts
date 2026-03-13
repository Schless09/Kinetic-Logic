/**
 * Expert Data Contribution & Release Agreement (versioned).
 * Tailored for embodied AI / Kinetic Trace data collection (e.g. Data Gym, Uzbekistan/Global).
 */

export const CONSENT_VERSION = "2025-03-v1";

export function getConsentAgreementText(locationPlaceholder: string): string {
  return `Expert Data Contribution & Release Agreement

Participant: ___________________________
Date: ___________________________
Location: ${locationPlaceholder}

1. Scope of Data Collection
I, the undersigned, understand that I am participating in a "Kinetic Trace" session. I authorize Kinetic Logic (the "Company") to record and capture the following:

• Egocentric & Exocentric Video: 1st-person (e.g. glasses) and 3rd-person (room camera) footage.
• Biometric Motion Data: High-frequency digital recordings of my movements, gestures, and physical force (IMU/Accelerometer data).
• Audio Narration: My voice explaining technical tasks and logic.

2. Purpose of Use (AI Training)
I understand that these recordings will be used to train Artificial Intelligence and Machine Learning models. This includes:

• Teaching robotic systems how to perform physical tasks.
• Developing "World Models" that understand human intent and physics.
• Creating synthetic datasets for research and commercial use, including sale or license to third-party AI labs.

3. Ownership & Intellectual Property
I acknowledge that Kinetic Logic (and/or the organization operating this Data Gym) shall be the sole owner of all right, title, and interest in the resulting data. I hereby waive any claim to royalties or further compensation beyond my agreed-upon rate for the time spent in the Data Gym.

4. Privacy & Anonymization
The Company agrees to take reasonable steps to protect my identity:

• Face-Blurring: Automated software may be used to obscure my face in video datasets shared or sold to third parties, unless I have opted in to "Enhanced Data Release" below.
• PII Scrubbing: Personal identifiable information (PII) mentioned in audio may be redacted.
• Secure Storage: Data will be stored in compliance with applicable local regulations.

5. Risks & Physical Safety
I confirm that I am performing tasks within my professional expertise. I assume all risks associated with the physical performance of these tasks and agree to follow all Data Gym safety protocols, including the use of any required Personal Protective Equipment (PPE).

6. Enhanced Data Release (Optional)
I understand that I may opt in to allow my data to be shared in a form that does not include face-blurring or other anonymization, which may command a higher rate. This is optional and I may leave this unchecked.

Expert Signature: ___________________________
Witness/Manager Signature: ___________________________`;
}
