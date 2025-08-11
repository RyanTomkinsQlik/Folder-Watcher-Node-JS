const fs = require('fs');
const path = require('path');

class FolderWatcher {
  constructor(watchPath, moveToFolder = null, enablePrinting = false) {
    this.watchPath = watchPath;
    this.moveToFolder = moveToFolder;
    this.enablePrinting = enablePrinting;
    this.existingFiles = new Set();
    this.isInitialized = false;
  }

  // Initialize by recording existing files
  async initialize() {
    try {
      // Ensure directory exists
      if (!fs.existsSync(this.watchPath)) {
        fs.mkdirSync(this.watchPath, { recursive: true });
        console.log(`Created directory: ${this.watchPath}`);
      }

      // Record existing files
      const files = fs.readdirSync(this.watchPath);
      files.forEach(file => {
        const filePath = path.join(this.watchPath, file);
        if (fs.statSync(filePath).isFile()) {
          this.existingFiles.add(file);
        }
      });

      console.log(`Watching folder: ${this.watchPath}`);
      console.log(`Initial files: ${Array.from(this.existingFiles).join(', ') || 'none'}`);
      console.log('Waiting for new files...\n');
      
      this.isInitialized = true;
    } catch (error) {
      console.error('Error initializing watcher:', error.message);
    }
  }

  // Read, display, and print file contents, then move file
  async printFileContents(filePath) {
    try {
      // Add a small delay to ensure file is fully written
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const fileName = path.basename(filePath);
      const fileExtension = path.extname(fileName).toLowerCase();
      
      console.log('='.repeat(50));
      console.log(`📄 NEW FILE: ${fileName}`);
      console.log(`📍 Path: ${filePath}`);
      console.log('='.repeat(50));
      
      // Handle different file types
      let content = '';
      let fileSize = 0;
      let shouldPrint = true;
      
      if (fileExtension === '.docx' || fileExtension === '.doc') {
        content = await this.readWordFile(filePath);
        fileSize = content.length;
      } else if (fileExtension === '.pdf') {
        content = await this.readPdfFile(filePath);
        fileSize = content.length;
        // For PDFs, we'll print the original file, not the extracted text
        shouldPrint = 'original';
      } else {
        // Handle as text file
        try {
          content = fs.readFileSync(filePath, 'utf8');
          fileSize = content.length;
        } catch (error) {
          // If UTF-8 fails, it might be binary - show file info only
          const stats = fs.statSync(filePath);
          fileSize = stats.size;
          content = `[Binary file - ${fileSize} bytes]\nUse a specialized application to view this file type.`;
          shouldPrint = false; // Don't print binary files
        }
      }
      
      console.log(`📊 Size: ${fileSize} characters`);
      console.log('='.repeat(50));
      console.log(content);
      console.log('='.repeat(50));
      console.log(''); // Empty line for spacing
      
      // Send to printer if enabled (BEFORE moving the file)
      if (this.enablePrinting && shouldPrint) {
        await this.sendToPrinter(filePath, fileName, content, shouldPrint);
      }
      
      // Move file AFTER printing (if moveToFolder is set)
      await this.moveFileAfterProcessing(filePath, fileName);
      
    } catch (error) {
      console.error(`Error reading file ${filePath}:`, error.message);
    }
  }

  // Read Word document content
  async readWordFile(filePath) {
    try {
      // For Word documents, we need the mammoth library
      const mammoth = require('mammoth');
      const result = await mammoth.extractRawText({ path: filePath });
      return result.value || '[Could not extract text from Word document]';
    } catch (error) {
      return `[Word document detected but mammoth library not available]\nFile: ${path.basename(filePath)}\nInstall with: npm install mammoth`;
    }
  }

  // Read PDF content (with pdf-parse library)
  async readPdfFile(filePath) {
    try {
      const pdfParse = require('pdf-parse');
      const dataBuffer = fs.readFileSync(filePath);
      const data = await pdfParse(dataBuffer);
      
      return data.text || '[PDF contains no extractable text]';
    } catch (error) {
      if (error.code === 'MODULE_NOT_FOUND') {
        const stats = fs.statSync(filePath);
        return `[PDF Document Detected]\nFile: ${path.basename(filePath)}\nSize: ${stats.size} bytes\n\nNote: Full PDF text extraction requires additional libraries.\nTo read PDF content, install: npm install pdf-parse\nFor now, the file has been detected and can be moved to the processed folder.`;
      } else {
        return `[Error extracting PDF text: ${error.message}]`;
      }
    }
  }

  // Send file to printer
  async sendToPrinter(filePath, fileName, content, printType) {
    try {
      console.log(`🖨️  Sending to printer: ${fileName}`);
      
      const { exec } = require('child_process');
      const util = require('util');
      const execAsync = util.promisify(exec);
      
      if (printType === 'original') {
        // Print original file (for PDFs, Word docs, etc.)
        // Use different approaches for Windows
        let printCommand;
        
        if (process.platform === 'win32') {
          // Method 1: Try using Windows print verb
          printCommand = `powershell -Command "Start-Process -FilePath '${filePath}' -Verb Print -WindowStyle Hidden -Wait"`;
        } else if (process.platform === 'darwin') {
          printCommand = `lpr "${filePath}"`;
        } else {
          printCommand = `lp "${filePath}"`;
        }
        
        console.log(`🔄 Executing print command for: ${fileName}`);
        await execAsync(printCommand);
        
        // Add a delay to ensure printing starts before moving
        console.log(`⏳ Waiting for print job to start...`);
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        console.log(`✅ Print command completed: ${fileName}`);
        
      } else {
        // Create temporary text file and print it
        const tempDir = require('os').tmpdir();
        const tempFilePath = path.join(tempDir, `temp_print_${Date.now()}.txt`);
        
        // Create printable content with header
        const printContent = `
FILE: ${fileName}
PATH: ${filePath}
PROCESSED: ${new Date().toLocaleString()}
${'='.repeat(60)}

${content}
        `.trim();
        
        // Write to temp file
        fs.writeFileSync(tempFilePath, printContent, 'utf8');
        
        // Print temp file
        const printCommand = process.platform === 'win32' 
          ? `notepad /p "${tempFilePath}"`
          : process.platform === 'darwin' 
            ? `lpr "${tempFilePath}"`
            : `lp "${tempFilePath}"`;
        
        console.log(`🔄 Printing text content for: ${fileName}`);
        await execAsync(printCommand);
        
        // Add delay for text printing too
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        console.log(`✅ Printed content to printer: ${fileName}`);
        
        // Clean up temp file after a delay
        setTimeout(() => {
          try {
            fs.unlinkSync(tempFilePath);
          } catch (error) {
            // Ignore cleanup errors
          }
        }, 5000);
      }
      
    } catch (error) {
      console.error(`❌ Failed to print ${fileName}:`, error.message);
      console.log(`💡 Make sure you have a default printer set up`);
      
      // If printing fails, we still want to continue with moving the file
      console.log(`⚠️  Continuing with file processing despite print error...`);
    }
  }
  async moveFileAfterProcessing(filePath, fileName) {
    if (!this.moveToFolder) return; // Skip if no move folder specified
    
    try {
      // Ensure destination folder exists
      if (!fs.existsSync(this.moveToFolder)) {
        fs.mkdirSync(this.moveToFolder, { recursive: true });
        console.log(`📁 Created destination folder: ${this.moveToFolder}`);
      }
      
      const destinationPath = path.join(this.moveToFolder, fileName);
      
      // Handle duplicate filenames by adding timestamp
      let finalDestination = destinationPath;
      if (fs.existsSync(destinationPath)) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const ext = path.extname(fileName);
        const nameWithoutExt = path.basename(fileName, ext);
        finalDestination = path.join(this.moveToFolder, `${nameWithoutExt}_${timestamp}${ext}`);
      }
      
      // Move the file
      fs.renameSync(filePath, finalDestination);
      console.log(`📦 Moved file to: ${finalDestination}`);
      
    } catch (error) {
      console.error(`❌ Error moving file ${fileName}:`, error.message);
    }
  }

  // Handle file system events
  async handleFileEvent(eventType, filename) {
    if (!filename || !this.isInitialized) return;

    const filePath = path.join(this.watchPath, filename);

    try {
      // Check if file exists and is actually a file
      if (!fs.existsSync(filePath)) return;
      
      const stats = fs.statSync(filePath);
      if (!stats.isFile()) return;

      // Check if this is a new file
      if (!this.existingFiles.has(filename)) {
        this.existingFiles.add(filename);
        console.log(`🔍 Detected new file: ${filename}`);
        await this.printFileContents(filePath);
      }
    } catch (error) {
      // File might have been deleted quickly, ignore
      if (error.code !== 'ENOENT') {
        console.error(`Error handling file event for ${filename}:`, error.message);
      }
    }
  }

  // Start watching the folder
  startWatching() {
    const watcher = fs.watch(this.watchPath, (eventType, filename) => {
      this.handleFileEvent(eventType, filename);
    });

    watcher.on('error', (error) => {
      console.error('Watcher error:', error.message);
    });

    // Handle graceful shutdown
    process.on('SIGINT', () => {
      console.log('\n🛑 Stopping file watcher...');
      watcher.close();
      process.exit(0);
    });

    return watcher;
  }
}

// Main execution
async function main() {
  // Get watch path from command line argument or use default
  const watchPath = process.argv[2] || 'C:\\Users\\SDP\\Documents\\WatchedItems';
  
  // Get move destination folder from command line (optional)
    const moveToFolder = process.argv[3] || 'C:\\Users\\SDP\\Documents\\ProcessedFiles';
  
  // Check if printing is enabled (optional 4th parameter)
    const enablePrinting = process.argv[4] === 'print' || process.argv[4] === 'true' || true; // Always print by default
  
  console.log('🔍 File Watcher Starting...');
  if (enablePrinting) {
    console.log('🖨️  Printer mode: ENABLED');
  }
  console.log('Press Ctrl+C to stop\n');

  const watcher = new FolderWatcher(watchPath, moveToFolder, enablePrinting);
  await watcher.initialize();
  
  if (moveToFolder) {
    console.log(`📦 Files will be moved to: ${moveToFolder} after processing`);
  }
  
  if (enablePrinting) {
    console.log(`🖨️  Files will be automatically printed`);
  }
  
  console.log(''); // Empty line
  watcher.startWatching();
}

// Export for use as module
module.exports = FolderWatcher;

// Run if this file is executed directly
if (require.main === module) {
  main().catch(console.error);
}