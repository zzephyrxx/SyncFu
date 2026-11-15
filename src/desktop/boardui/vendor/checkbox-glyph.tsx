// Adapted from BoardUI CheckboxGlyph, MIT © 2026 BoardUI.
// Removed the upstream selected-fill gradient. Glyphs use Morphicons + Lucide.
import {cx} from '../cx';
import {AppIcon} from '../icons';
export type CheckboxSize='sm'|'md';
export const checkboxSizes={md:{box:'size-4',glyph:'size-4',label:'text-body-medium',gap:'gap-2'},sm:{box:'size-3.5',glyph:'size-3.5',label:'text-body-2-medium',gap:'gap-1.5'}};
export interface CheckboxGlyphState{isSelected:boolean;isIndeterminate:boolean;isFocusVisible:boolean;isDisabled:boolean;isHovered:boolean}
export function CheckboxGlyph({state,size='md'}:{state:CheckboxGlyphState;size?:CheckboxSize}){
  const marked=state.isSelected||state.isIndeterminate;
  return <span aria-hidden="true" data-marked={marked} className={cx('bui-checkbox-glyph flex shrink-0 items-center justify-center rounded-sm',checkboxSizes[size].box,state.isDisabled&&'opacity-50',state.isFocusVisible&&'bui-focus-ring')}>
    {marked&&<AppIcon name={state.isIndeterminate?'Minus':'Check'} size={size==='md'?13:12} strokeWidth={2.5}/>}
  </span>;
}
