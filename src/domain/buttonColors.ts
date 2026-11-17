import { ButtonColor } from './types';

export const BUTTON_COLORS: Array<{ value: ButtonColor; label: string; swatchClass: string }> = [
  { value: 'default', label: 'Bílá (výchozí)', swatchClass: 'bg-white border-parchment-300' },
  { value: 'gray', label: 'Šedá', swatchClass: 'bg-gray-200 border-gray-300' },
  { value: 'red', label: 'Červená', swatchClass: 'bg-red-200 border-red-300' },
  { value: 'green', label: 'Zelená', swatchClass: 'bg-green-200 border-green-300' },
  { value: 'yellow', label: 'Žlutá', swatchClass: 'bg-yellow-200 border-yellow-300' },
  { value: 'orange', label: 'Oranžová', swatchClass: 'bg-orange-200 border-orange-300' },
  { value: 'blue', label: 'Modrá', swatchClass: 'bg-blue-200 border-blue-300' },
  { value: 'brown', label: 'Hnědá', swatchClass: 'bg-amber-200 border-amber-300' },
];

const BUTTON_COLOR_CLASSES: Record<ButtonColor, string> = {
  default: 'bg-white border-parchment-300 hover:bg-parchment-50',
  gray: 'bg-gray-200 border-gray-300 hover:bg-gray-300',
  red: 'bg-red-200 border-red-300 hover:bg-red-300',
  green: 'bg-green-200 border-green-300 hover:bg-green-300',
  yellow: 'bg-yellow-200 border-yellow-300 hover:bg-yellow-300',
  orange: 'bg-orange-200 border-orange-300 hover:bg-orange-300',
  blue: 'bg-blue-200 border-blue-300 hover:bg-blue-300',
  brown: 'bg-amber-200 border-amber-300 hover:bg-amber-300',
};

export function getButtonColorClasses(color?: ButtonColor): string {
  return BUTTON_COLOR_CLASSES[color ?? 'default'] ?? BUTTON_COLOR_CLASSES.default;
}
