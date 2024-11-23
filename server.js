const tesseract = require("tesseract.js");
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");
const createCsvWriter = require("csv-writer").createObjectCsvWriter;
const ruleEngine = require('./rule.json'); // Import rule-engine configuration
// Directory containing check images
const directoryPath = ruleEngine.inputPath.problem3; // Update with the correct path
// Specify output directory for CSV files
const outputDirectory = ruleEngine.outputPath.problem3; // You can change this to any directory path you prefer
// Ensure output directory exists
if (!fs.existsSync(outputDirectory)) {
  fs.mkdirSync(outputDirectory);
}
// Extract transaction ranges from the rule engine config
const transactionRanges = ruleEngine.rules[2].conditions.transactionRanges; // { low, medium, high }
console.log('Transaction Ranges:', transactionRanges);
// Preprocess the image to improve OCR accuracy
async function preprocessImage(inputPath, outputPath) {
  try {
      await sharp(inputPath)
          .grayscale() // Convert to grayscale
          .resize({ width: 2000 }) // Resize for better clarity
          .toFile(outputPath);
      console.log(`Preprocessed image saved to ${outputPath}`);
  } catch (err) {
      console.error(`Error preprocessing image ${inputPath}:`, err);
  }
}
// Extract details from a single check image
async function extractCheckDetails(imagePath) {
  try {
      const processedImagePath = `processed_${path.basename(imagePath)}`;
      await preprocessImage(imagePath, processedImagePath);
      // Perform OCR on the processed image
      const { data: { text } } = await tesseract.recognize(processedImagePath);
      // Debug OCR output
      console.log(`OCR Output for ${imagePath}:\n`, text);
      // Extract Payee Name
      const payeeNameMatch = text.match(/PAY TO THE.*?([\w\s.]+)/i);
      const payeeName = payeeNameMatch ? payeeNameMatch[1].trim() : null;
      // Extract Amount in Dollars
      const amountMatch = text.match(/\$\s*([\d,]+\.\d{2})/);
      const amount = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, "")) : null;
      // Extract Account Number and Transaction IDs
      const match = text.match(/Account\s*Number[.\s]*([A-Z0-9]+)\s*\*([\w\s]+)/i);
      const accountNumber = match ? match[1].trim() : null;
      const transactionIds = match ? match[2].trim().replace(/\s+/g, " ") : null;
      console.log("Extracted Data:");
      console.log(`Payee Name: ${payeeName}`);
      console.log(`Amount: ${amount}`);
      console.log(`Account Number: ${accountNumber}`);
      console.log(`Transaction IDs: ${transactionIds}`);
      // Return extracted details
      return {
          payeeName,
          amount,
          accountNumber,
          transactionIds
      };
  } catch (err) {
      console.error(`Error extracting details from ${imagePath}:`, err);
      return null;
  }
}
// Main program
(async () => {
  // Initialize CSV writers for each category
  const categories = {
      low: { filename: "low_volume.csv", range: transactionRanges.low },
      medium: { filename: "medium_volume.csv", range: transactionRanges.medium },
      high: { filename: "high_volume.csv", range: transactionRanges.high },
  };
  const csvWriters = {};
  for (const [key, { filename }] of Object.entries(categories)) {
      const filePath = path.join(outputDirectory, filename);
      const fileExists = fs.existsSync(filePath);
      csvWriters[key] = createCsvWriter({
          path: filePath,
          header: [
              { id: "accountNumber", title: "Account Number" },
              { id: "payeeName", title: "Payee Name" },
              { id: "totalAmount", title: "Total Amount" },
              { id: "transactionIds", title: "Transaction IDs" },
          ],
          append: fileExists, // Append if the file exists
      });
      // If the file doesn't exist, write headers by writing an empty record
      if (!fileExists) {
          await csvWriters[key].writeRecords([]);
      }
  }
  // Process all check images in the directory
  const files = fs.readdirSync(directoryPath);
  for (const file of files) {
      const filePath = path.join(directoryPath, file);
      // Skip non-image files
      if (!/\.(png|jpe?g)$/i.test(file)) {
          console.log(`Skipping non-image file: ${file}`);
          continue;
      }
      console.log(`Processing ${file}...`);
      const details = await extractCheckDetails(filePath);
      if (details) {
          const { accountNumber, payeeName, amount, transactionIds } = details;
          if (accountNumber && amount !== null) {
              // Determine the category based on the amount
              for (const [key, { range }] of Object.entries(categories)) {
                  if (amount >= range.min && amount <= range.max) {
                      // Write the record to the appropriate CSV file
                      await csvWriters[key].writeRecords([{
                          accountNumber,
                          payeeName,
                          totalAmount: amount,
                          transactionIds: transactionIds || "",
                      }]);
                      console.log(`Written to ${key} volume CSV: ${file}`);
                      break;
                  }
              }
          } else {
              console.warn(`Account number or amount not found for ${file}`);
          }
      } else {
          console.warn(`Failed to extract details for ${file}`);
      }
  }
  console.log("Processing completed.");
})();
