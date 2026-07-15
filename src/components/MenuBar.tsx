import { useCallback, useState } from 'react';
import type { Editor } from '@tiptap/react';
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Code,
  SquareCode,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListChecks,
  Quote,
  Minus,
  Link as LinkIcon,
  Unlink,
  Image as ImageIcon,
  Table as TableIcon,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  Highlighter,
  Undo,
  Redo,
  Subscript as SubscriptIcon,
  Superscript as SuperscriptIcon,
  Palette,
  Workflow,
  Asterisk,
  Sigma,
  SquareSigma,
} from 'lucide-react';
import { ToolbarButton, ToolbarDivider } from './ToolbarButton';
import { LinkModal } from './LinkModal';
import { ImageModal } from './ImageModal';
import { TableMenu } from './TableMenu';
import { ColorPicker } from './ColorPicker';
import { t } from '../lib/i18n';

export const MenuBar = ({
  editor,
  onBrowseImage,
}: {
  editor: Editor | null;
  onBrowseImage?: () => Promise<string | null>;
}) => {
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [showImageModal, setShowImageModal] = useState(false);
  const [showTableMenu, setShowTableMenu] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showHighlightPicker, setShowHighlightPicker] = useState(false);

  const setLink = useCallback(
    (url: string) => {
      if (!editor) return;
      if (url === '') {
        editor.chain().focus().extendMarkRange('link').unsetLink().run();
      } else {
        editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
      }
      setShowLinkModal(false);
    },
    [editor]
  );

  const addImage = useCallback(
    (url: string, alt: string) => {
      if (editor && url) {
        editor.chain().focus().setImage({ src: url, alt }).run();
      }
      setShowImageModal(false);
    },
    [editor]
  );

  if (!editor) return null;

  return (
    <>
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-2 py-1.5 no-select">
        <div className="flex flex-wrap items-center gap-0.5">
          {/* Undo/Redo */}
          <ToolbarButton
            onClick={() => editor.chain().focus().undo().run()}
            disabled={!editor.can().undo()}
            title={t('editor.undo')}
          >
            <Undo className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().redo().run()}
            disabled={!editor.can().redo()}
            title={t('editor.redo')}
          >
            <Redo className="w-4 h-4" />
          </ToolbarButton>

          <ToolbarDivider />

          {/* Headings */}
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            isActive={editor.isActive('heading', { level: 1 })}
            title={t('editor.heading1')}
          >
            <Heading1 className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            isActive={editor.isActive('heading', { level: 2 })}
            title={t('editor.heading2')}
          >
            <Heading2 className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            isActive={editor.isActive('heading', { level: 3 })}
            title={t('editor.heading3')}
          >
            <Heading3 className="w-4 h-4" />
          </ToolbarButton>

          <ToolbarDivider />

          {/* Text formatting */}
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBold().run()}
            isActive={editor.isActive('bold')}
            title={t('editor.bold')}
          >
            <Bold className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleItalic().run()}
            isActive={editor.isActive('italic')}
            title={t('editor.italic')}
          >
            <Italic className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            isActive={editor.isActive('underline')}
            title={t('editor.underline')}
          >
            <UnderlineIcon className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleStrike().run()}
            isActive={editor.isActive('strike')}
            title={t('editor.strikethrough')}
          >
            <Strikethrough className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleCode().run()}
            isActive={editor.isActive('code')}
            title={t('editor.inlineCode')}
          >
            <Code className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleSubscript().run()}
            isActive={editor.isActive('subscript')}
            title={t('editor.subscript')}
          >
            <SubscriptIcon className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleSuperscript().run()}
            isActive={editor.isActive('superscript')}
            title={t('editor.superscript')}
          >
            <SuperscriptIcon className="w-4 h-4" />
          </ToolbarButton>

          <ToolbarDivider />

          {/* Color & Highlight */}
          <div className="relative">
            <ToolbarButton
              onClick={() => setShowColorPicker(!showColorPicker)}
              title={t('editor.textColor')}
            >
              <Palette className="w-4 h-4" />
            </ToolbarButton>
            <ColorPicker
              isOpen={showColorPicker}
              onClose={() => setShowColorPicker(false)}
              onSelect={(color) => {
                if (color) {
                  editor.chain().focus().setColor(color).run();
                } else {
                  editor.chain().focus().unsetColor().run();
                }
              }}
            />
          </div>
          <div className="relative">
            <ToolbarButton
              onClick={() => setShowHighlightPicker(!showHighlightPicker)}
              isActive={editor.isActive('highlight')}
              title={t('editor.highlight')}
            >
              <Highlighter className="w-4 h-4" />
            </ToolbarButton>
            <ColorPicker
              isOpen={showHighlightPicker}
              onClose={() => setShowHighlightPicker(false)}
              onSelect={(color) => {
                if (color) {
                  editor.chain().focus().toggleHighlight({ color }).run();
                } else {
                  editor.chain().focus().unsetHighlight().run();
                }
              }}
            />
          </div>

          <ToolbarDivider />

          {/* Alignment */}
          <ToolbarButton
            onClick={() => editor.chain().focus().setTextAlign('left').run()}
            isActive={editor.isActive({ textAlign: 'left' })}
            title={t('editor.alignLeft')}
          >
            <AlignLeft className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().setTextAlign('center').run()}
            isActive={editor.isActive({ textAlign: 'center' })}
            title={t('editor.alignCenter')}
          >
            <AlignCenter className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().setTextAlign('right').run()}
            isActive={editor.isActive({ textAlign: 'right' })}
            title={t('editor.alignRight')}
          >
            <AlignRight className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().setTextAlign('justify').run()}
            isActive={editor.isActive({ textAlign: 'justify' })}
            title={t('editor.justify')}
          >
            <AlignJustify className="w-4 h-4" />
          </ToolbarButton>

          <ToolbarDivider />

          {/* Lists */}
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            isActive={editor.isActive('bulletList')}
            title={t('editor.bulletList')}
          >
            <List className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            isActive={editor.isActive('orderedList')}
            title={t('editor.orderedList')}
          >
            <ListOrdered className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleTaskList().run()}
            isActive={editor.isActive('taskList')}
            title={t('editor.taskList')}
          >
            <ListChecks className="w-4 h-4" />
          </ToolbarButton>

          <ToolbarDivider />

          {/* Block elements */}
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            isActive={editor.isActive('blockquote')}
            title={t('editor.blockquote')}
          >
            <Quote className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            isActive={editor.isActive('codeBlock')}
            title={t('editor.codeBlock')}
          >
            <SquareCode className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
            title={t('editor.horizontalRule')}
          >
            <Minus className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().insertMermaid().run()}
            isActive={editor.isActive('mermaid')}
            title={t('editor.insertMermaid')}
          >
            <Workflow className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().insertFootnote().run()}
            title={t('editor.insertFootnote')}
          >
            <Asterisk className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().insertMathInline().run()}
            isActive={editor.isActive('mathInline')}
            title={t('editor.insertMathInline')}
          >
            <Sigma className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().insertMathBlock().run()}
            isActive={editor.isActive('mathBlock')}
            title={t('editor.insertMathBlock')}
          >
            <SquareSigma className="w-4 h-4" />
          </ToolbarButton>

          <ToolbarDivider />

          {/* Link */}
          <ToolbarButton
            onClick={() => setShowLinkModal(true)}
            isActive={editor.isActive('link')}
            title={t('editor.insertLink')}
          >
            <LinkIcon className="w-4 h-4" />
          </ToolbarButton>
          {editor.isActive('link') && (
            <ToolbarButton
              onClick={() => editor.chain().focus().unsetLink().run()}
              title={t('editor.removeLink')}
            >
              <Unlink className="w-4 h-4" />
            </ToolbarButton>
          )}

          {/* Image */}
          <ToolbarButton onClick={() => setShowImageModal(true)} title={t('editor.insertImage')}>
            <ImageIcon className="w-4 h-4" />
          </ToolbarButton>

          {/* Table */}
          <div className="relative">
            <ToolbarButton
              onClick={() => setShowTableMenu(!showTableMenu)}
              isActive={editor.isActive('table')}
              title={t('editor.table')}
            >
              <TableIcon className="w-4 h-4" />
            </ToolbarButton>
            <TableMenu
              editor={editor}
              isOpen={showTableMenu}
              onClose={() => setShowTableMenu(false)}
            />
          </div>
        </div>
      </div>

      {/* Modals */}
      <LinkModal
        isOpen={showLinkModal}
        onClose={() => setShowLinkModal(false)}
        onSubmit={setLink}
        initialUrl={editor.getAttributes('link').href || ''}
      />
      <ImageModal
        isOpen={showImageModal}
        onClose={() => setShowImageModal(false)}
        onSubmit={addImage}
        onBrowse={onBrowseImage}
      />
    </>
  );
};
