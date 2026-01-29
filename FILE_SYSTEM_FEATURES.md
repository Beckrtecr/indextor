# File System Management Features - Indextor

## New Features Added

### 1. **Create Folders**
- **Location**: Explorer sidebar header
- **Button**: "New Folder" button (folder icon with plus sign)
- **How to use**: 
  1. Click the "New Folder" button in the sidebar
  2. Enter the folder name in the prompt
  3. The folder will be created in the root directory
  4. The file tree will automatically refresh to show the new folder

### 2. **Delete Files and Folders**
- **Access**: Right-click context menu
- **How to use**:
  1. Right-click on any file or folder in the file tree
  2. Select "Delete" from the context menu (trash icon)
  3. Confirm the deletion in the confirmation dialog
  4. For folders: All contents will be deleted recursively
  5. The file tree will automatically refresh

### 3. **Rename Files**
- **Access**: Right-click context menu
- **How to use**:
  1. Right-click on any file in the file tree
  2. Select "Rename" from the context menu (pencil icon)
  3. Enter the new name in the prompt (pre-filled with current name)
  4. The file will be copied with the new name and the old file deleted
  5. The file tree will automatically refresh

### 4. **Rename Folders**
- **Status**: Limited support
- **Note**: Due to the complexity of recursively copying folder contents, folder renaming currently shows a message suggesting manual operation (create new folder and move files)
- **Future Enhancement**: Full folder rename support can be added with recursive copy functionality

## Context Menu

The right-click context menu provides quick access to file operations:
- **Rename** (✏️): Rename the selected file or folder
- **Delete** (🗑️): Delete the selected file or folder

The context menu features:
- Modern glassmorphic design matching the app aesthetic
- Smooth fade-in animation
- Hover effects for better UX
- Automatic closing when clicking outside

## UI Updates

### Explorer Sidebar Header
Now contains three action buttons:
1. **New File** - Create a new file
2. **New Folder** - Create a new folder (NEW)
3. **Import File** - Import files from your system

### Styling
- Context menu uses the app's design system
- Glassmorphic background with backdrop blur
- Consistent with light/dark theme
- Smooth animations and transitions

## Technical Implementation

### Key Functions Added:
- `createNewFolder()` - Creates a new folder in the root directory
- `renameItem(node)` - Renames files (folders show limitation message)
- `deleteItem(node)` - Deletes files or folders with recursive option
- `showContextMenu(x, y, node)` - Displays the context menu at cursor position

### File System API Usage:
- `getDirectoryHandle()` - For creating folders
- `removeEntry()` - For deleting files/folders with recursive option
- `getFileHandle()` - For creating renamed files
- `createWritable()` - For writing file contents

### State Management:
- Automatic file tree refresh after operations
- Proper cleanup of open files when deleted
- Context menu state management
- File handle tracking

## User Experience Improvements

1. **Visual Feedback**: 
   - Confirmation dialogs for destructive operations
   - Alert messages for operation results
   - Active state highlighting

2. **Safety Features**:
   - Confirmation required for deletions
   - Clear messaging about folder rename limitations
   - Error handling with user-friendly messages

3. **Accessibility**:
   - Keyboard-friendly prompts
   - Clear button labels and tooltips
   - Intuitive right-click interactions

## Browser Compatibility

These features use the File System Access API, which requires:
- Chrome/Edge 86+
- Opera 72+
- Safari 15.2+ (with limitations)
- Not supported in Firefox (as of current version)

## Future Enhancements

Potential improvements:
- Full folder rename with recursive copy
- Drag-and-drop file moving
- Copy/paste operations
- Keyboard shortcuts for file operations
- Multi-select for batch operations
- Undo/redo functionality
