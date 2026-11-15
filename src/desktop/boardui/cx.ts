import {clsx,type ClassValue} from 'clsx';
import {twMerge} from 'tailwind-merge';
export const cx=(...values:ClassValue[])=>twMerge(clsx(values));
export const sortCx=<T,>(value:T)=>value;
// Current supported locales are LTR; file direction comes from the actual target,
// not from a styling helper or the connection initiator.
export const directionalIconClass=(_icon:unknown)=>'';
