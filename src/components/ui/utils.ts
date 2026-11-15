import {clsx,type ClassValue} from 'clsx';
import {twMerge} from 'tailwind-merge';

// shadcn's cn contract, using the existing local class utilities.
export function cn(...inputs:ClassValue[]){return twMerge(clsx(inputs));}
