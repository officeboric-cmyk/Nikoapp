/** Made-up airlines whose colours the passenger plane can wear. */

export interface Airline {
  id: string;
  name: string;
  tail: number; // colour of the tail fin
  stripe: number; // colour of the line along the fuselage
  text: string; // CSS colour of the name painted on the side
}

export const AIRLINES: Airline[] = [
  { id: 'niko', name: 'Niko Air', tail: 0x1d3557, stripe: 0xff8c42, text: '#1d3557' },
  { id: 'jadran', name: 'Jadran Jet', tail: 0xd62828, stripe: 0x003f88, text: '#d62828' },
  { id: 'galeb', name: 'Galeb Air', tail: 0x2a9d8f, stripe: 0xe9c46a, text: '#21867a' },
  { id: 'otok', name: 'Otok Express', tail: 0x7b2cbf, stripe: 0xffc300, text: '#7b2cbf' },
];

export function airlineById(id: string | undefined): Airline {
  return AIRLINES.find((a) => a.id === id) ?? AIRLINES[0];
}
