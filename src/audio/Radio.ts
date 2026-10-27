/**
 * Air traffic control on the radio: short calls from the tower, spoken by the browser's
 * own speech in Croatian (or a close language) when the device has such a voice, and
 * always shown on screen as text. No sound files are needed.
 */

const LANGUAGES = ['hr', 'bs', 'sr', 'sl']; // Croatian first, then languages that read it well
const REPEAT_AFTER = 20; // s before the same kind of call may come again

export class Radio {
  private voice: SpeechSynthesisVoice | null = null;
  private readonly last = new Map<string, number>();
  muted = false;

  constructor() {
    if (!Radio.canSpeak) return;
    const pick = () => (this.voice = findVoice());
    pick();
    speechSynthesis.addEventListener?.('voiceschanged', pick);
  }

  static get canSpeak(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
  }

  /** Whether calls are heard as well as read. */
  get speaking(): boolean {
    return this.voice !== null && !this.muted;
  }

  /**
   * A call from the tower. `kind` groups calls so the same one isn't repeated within
   * `repeatAfter` seconds. Returns the text to show, or null if this kind of call was made just now.
   */
  call(kind: string, text: string, now: number, repeatAfter = REPEAT_AFTER): string | null {
    const last = this.last.get(kind);
    if (last !== undefined && now - last < repeatAfter) return null;
    this.last.set(kind, now);
    if (this.speaking) {
      try {
        speechSynthesis.cancel(); // the newest call matters most
        const utterance = new SpeechSynthesisUtterance(text.replace(/[^\p{L}\p{N}\s,.!?:-]/gu, ''));
        utterance.voice = this.voice;
        utterance.lang = this.voice!.lang;
        utterance.rate = 1.05;
        speechSynthesis.speak(utterance);
      } catch {
        // Speech is a bonus: if the browser refuses, the call is still shown as text.
      }
    }
    return text;
  }

  /** Forget the last calls (a new flight starts). */
  reset(): void {
    this.last.clear();
    if (Radio.canSpeak) speechSynthesis.cancel();
  }

  /** Stops talking while the game is paused or hidden. */
  silence(): void {
    if (Radio.canSpeak) speechSynthesis.cancel();
  }
}

function findVoice(): SpeechSynthesisVoice | null {
  const voices = speechSynthesis.getVoices();
  for (const language of LANGUAGES) {
    const voice = voices.find((v) => v.lang.toLowerCase().startsWith(language));
    if (voice) return voice;
  }
  return null;
}

/** "vjetar sa zapada, 12 čvorova" from the wind (m/s, towards +X = east, +Z = south). */
export function windWords(x: number, z: number): string {
  const speed = Math.hypot(x, z);
  if (speed < 1) return 'bez vjetra';
  // The wind is named after where it comes from, the opposite of where it blows.
  const from = (Math.atan2(-x, z) * 180) / Math.PI; // 0 = from the north, 90 = from the east
  const names = ['sjevera', 'sjeveroistoka', 'istoka', 'jugoistoka', 'juga', 'jugozapada', 'zapada', 'sjeverozapada'];
  const name = names[Math.round((((from % 360) + 360) % 360) / 45) % 8];
  const knots = Math.round(speed * 1.944);
  return `vjetar s${name.startsWith('s') || name.startsWith('z') ? 'a' : ''} ${name}, ${knots} čvorova`;
}
