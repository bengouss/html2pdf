import type { PDFArray, PDFDict, PDFDocument, PDFImage, PDFName, PDFNumber, PDFObject, PDFRawStream, PDFRef } from "pdf-lib"
import fs from "fs"
import crypto from "crypto"
import zlib from "zlib"
import sharp from "sharp"

// We need to import pdf-lib dynamically to avoid issues with bundling
const pdflib: typeof import("pdf-lib") = require("pdf-lib")

const defaultJpegQuality = 70; // Default JPEG quality for compression

const findColorSpace = (doc:PDFDocument, colorSpace: PDFName | PDFRef | undefined) => {
  let colorSpaceName = "/DeviceRGB"
  if(colorSpace instanceof pdflib.PDFName) {
    // console.log(` ColorSpace:${colorSpace.asString()}`);
    colorSpaceName = colorSpace.toString();
  } else if(colorSpace instanceof pdflib.PDFRef) {
    const colorSpaceObj = doc.context.lookup(colorSpace);
    if(!colorSpaceObj) {
      // console.log(`ColorSpace reference ${colorSpace.toString()} not found`);
    } else {
      // console.log(` ColorSpace reference ${colorSpace.toString()}:`, colorSpaceObj.constructor.name);
      if(colorSpaceObj instanceof pdflib.PDFArray) {
        colorSpaceObj.asArray().forEach((c, index) => {
          if(c instanceof pdflib.PDFName) {
            // console.log(`   ColorSpace array ${index}:name ${c.constructor.name} => ${c.toString()}`);
          } else if(c instanceof pdflib.PDFRef) {
            const colorSpaceRefObj = doc.context.lookup(c);
            if(!colorSpaceRefObj) {
              // console.log(`   ColorSpace array ${index}:ref  ${c.constructor.name} => Reference not found`);
            } else {
              const colorSpaceObj = (colorSpaceRefObj as PDFRawStream)
              const colorSpaceRefAlternate = colorSpaceObj.dict.get(pdflib.PDFName.of('Alternate')) as PDFName | undefined;
              const colorSpaceRefFilter = colorSpaceObj.dict.get(pdflib.PDFName.of('Filter')) as PDFName | undefined;
              const colorSpaceRefData = Buffer.from(colorSpaceRefFilter && colorSpaceRefFilter.toString() === "/FlateDecode" ? zlib.inflateSync(colorSpaceObj.contents) : colorSpaceObj.contents);
              colorSpaceName = colorSpaceRefAlternate?.toString() || "/DeviceRGB"
              // console.log(`   ColorSpace array ${index}:ref  ${c.constructor.name} => `, colorSpaceRefAlternate?.toString(), colorSpaceRefData);
            }
          } else {
            // console.log(`   ColorSpace array ${index}: ${c.constructor.name} => ${c.toString()}`);
          }
        })
      }
    }
  }
  return colorSpaceName
}

const handleRawStream = (pdfObject: PDFRawStream, depth = 0) => {
  const prefix = new Array(depth).fill("  ").join("")
  const filter = pdfObject.dict.get(pdflib.PDFName.of('Filter')) as PDFName | undefined;
  const isCompressed = filter && filter.toString() === "/FlateDecode";
  const contents = isCompressed ? zlib.inflateSync(pdfObject.contents) : pdfObject.contents;
  console.log(`${prefix}  Contents:`, contents.toString()); // Print first 100 bytes of contents
}

const handleName = (pdfObject: PDFName, depth = 0) => {
  const prefix = new Array(depth).fill("  ").join("")
  console.log(`${prefix}  Name:`, pdfObject.asString());
}

const handleDict = (doc:PDFDocument, pdfDict: PDFDict, depth = 0) => {
  const prefix = new Array(depth).fill("  ").join("")
  const entries = pdfDict.entries();
  entries.forEach(([key, value]) => {
    console.log(`${prefix}  ${key.asString()}: ${value.constructor.name}`);
    handleObject(doc, value, depth + 1);
  });
}

const handleObject = (doc:PDFDocument, pdfObject: PDFObject, depth = 0) => {
  const className = pdfObject.constructor.name;
  const prefix = new Array(depth).fill("  ").join("")
  console.log(`${prefix}Object:`, className);
  if(className === "PDFDict") handleDict(doc, pdfObject as PDFDict, depth + 1);
  else if(className === "PDFArray") {
    const array = pdfObject as PDFArray;
    const objs = array.asArray()
    objs?.forEach((value, index) => {
      console.log(`${prefix}  Array[${index}]:`, value.constructor.name);
      handleObject(doc, value, depth + 1)
    })
  }
  else if(className === "PDFName") handleName(pdfObject as PDFName, depth + 1);
  else if(className === "PDFRef") {
    const ref = pdfObject as PDFRef;
    console.log(`${prefix}  Ref:`, ref.toString());
    const obj = doc.context.lookup(ref);
    if(obj) {
      console.log(`${prefix}  Ref object type:`, obj.constructor.name);
      handleObject(doc, obj, depth + 1);
    } else {
      console.log(`${prefix}  Ref object not found`);
    }
  } else if(className === "PDFRawStream") {
    handleRawStream(pdfObject as PDFRawStream, depth + 1);
  } else {
    console.log(`${prefix}  Unknown object type:`, className);
  }
}

const handleImage = async (doc:PDFDocument, pdfRef:PDFRef, pdfObject: PDFRawStream, objectIdx:number, jpegQuality = defaultJpegQuality) => {
  const filter = pdfObject.dict.get(pdflib.PDFName.of('Filter')) as PDFName | undefined;
  const width = pdfObject.dict.get(pdflib.PDFName.of('Width')) as PDFNumber
  const height = pdfObject.dict.get(pdflib.PDFName.of('Height')) as PDFNumber
  // const name = pdfObject.dict.get(pdflib.PDFName.of('Name')) as PDFName | undefined
  const colorSpace = pdfObject.dict.get(pdflib.PDFName.of('ColorSpace')) as PDFName | PDFRef | undefined
  const bitsPerComponent = pdfObject.dict.get(pdflib.PDFName.of('BitsPerComponent')) as PDFNumber | undefined
  const sMask = pdfObject.dict.get(pdflib.PDFName.of('SMask')) as PDFRef | undefined
  const isJPG = filter && filter.toString() === "/DCTDecode";
  const isCompressedPPGM = filter && filter.toString() === "/FlateDecode";
  const originalData = Buffer.from(isCompressedPPGM ? zlib.inflateSync(pdfObject.contents) : pdfObject.contents);
  const colorSpaceName = findColorSpace(doc, colorSpace);

  const isPPM = isCompressedPPGM && colorSpaceName === "/DeviceRGB";
  const isPGM = isCompressedPPGM && colorSpaceName === "/DeviceGray";

  let imageData = new Uint8Array(originalData);
  if(isJPG) {
    // this is already compressed, do nothing
  } else if(isPPM) {
    // create PPM header and buffer
    const ppmHeader = `P6\n${width.asNumber()} ${height.asNumber()}\n255\n`;
    const ppmBuffer = Buffer.concat([Buffer.from(ppmHeader, 'utf8'), imageData]);
    // console.log(`Image is PPM, size: ${data.byteLength} bytes`);
    imageData = new Uint8Array(ppmBuffer);

    const compressed = await sharp(imageData, {
      raw: {
        width: width.asNumber(),
        height: height.asNumber(),
        channels: 3
      }
    })
    .jpeg({ quality: jpegQuality })
    .toBuffer()

    console.log(`Compressed PPM to JPEG, saving ${(imageData.byteLength-compressed.byteLength)/1024} KB`);

    //@ts-ignore
    pdfObject.contents = compressed; // Replace the contents with compressed JPEG data
    pdfObject.dict.set(pdflib.PDFName.of('Filter'), pdflib.PDFName.of('DCTDecode')); // Set filter to DCTDecode for JPEG
    pdfObject.dict.set(pdflib.PDFName.of('Length'), pdflib.PDFNumber.of(pdfObject.contents.byteLength)); // Set length to the new compressed size
  } else if(isPGM) {
    // this is likely a transparency bitmap (SMask), do nothing for now
  }

  console.log(`Found image object at index ${objectIdx}:`,
    `${width}x${height}@${bitsPerComponent}`,
    `Tag:${pdfRef.tag}`,
    `Filter:${filter}`,
    `ColorSpace:${colorSpaceName}`,
    `sMask:${sMask?.toString() || "-"}`,
    `length:${pdfObject.contents.byteLength}`
  );

  const imgInDoc:ImageInDoc = {
    pdfRef,
    pdfObject,
    objectNumber: pdfRef.objectNumber,
    name: `Object_${objectIdx}`,
    width: width?.asNumber(),
    height: height?.asNumber(),
    bitsPerComponent: bitsPerComponent?.asNumber() || 8, // Default to 8 if not specified
    data: pdfObject.contents,
    hash: crypto.createHash('md5').update(originalData).digest('hex')
  }

  return imgInDoc;
}

type ImageInDoc = {
  pdfRef: PDFRef;
  pdfObject: PDFRawStream;
  objectNumber: number;
  name: string;
  width?: number;
  height?: number;
  bitsPerComponent: number;
  data: Uint8Array;
  hash: string
}

const compress = async (pdf: Uint8Array | Buffer, uuid:string, jpegQuality?:number) => {
  console.log(`Starting PDF compression jpegQuality:${jpegQuality || defaultJpegQuality}`);
  const doc = await pdflib.PDFDocument.load(pdf)
  console.log("PDF document loaded successfully");
  let objectIdx = 0;
  
  const objects = doc.context.enumerateIndirectObjects()
  console.log(`Found ${objects.length} objects in PDF document`);

  const imagesInDoc:Map<string, ImageInDoc[]> = new Map();
  const imagesInDocByObjectNumber:Map<number, ImageInDoc> = new Map();

  // objects.forEach(([pdfRef, pdfObject]) => {
  for(var i in objects) {
    const [pdfRef, pdfObject] = objects[i];
    // console.log(`Processing object ${pdfRef.objectNumber} (${pdfRef.tag}) => ${pdfObject.constructor.name}`);
    objectIdx += 1;
  
    const dict:PDFDict | undefined = (pdfObject as PDFRawStream)?.dict || (pdfObject as PDFDict);

    if(!dict) {
      console.log(`Object ${pdfRef.objectNumber} (${pdfRef.tag}) has no dictionary, skipping...`);
      continue;
    }

    const type = dict.get(pdflib.PDFName.of('Type'))
    const subtype = dict.get(pdflib.PDFName.of('Subtype'));
    if (!!subtype && subtype === pdflib.PDFName.of('Image') && !!type && type === pdflib.PDFName.of('XObject')) {
      const img = await handleImage(doc, pdfRef, pdfObject as PDFRawStream, objectIdx, jpegQuality);

      // Store images into two hashmaps: one containing all the images ordered by object number, one by image md5 to find duplicates
      if(imagesInDoc.has(img.hash)) {
        imagesInDoc.get(img.hash)!.push(img);
      } else {
        imagesInDoc.set(img.hash, [img]);
      }
      imagesInDocByObjectNumber.set(img.objectNumber, img);

    } else {
      // console.log(`Skipping: ${pdfRef.objectNumber} (${pdfRef.tag}) => ${pdfObject.constructor.name}`);
    }
  }

  // TODO: Remove duplicate images and use a single reference to the image data (see imagesInDoc map)
  // TODO: Optimize/reduce size of transparency masks (SMask)

  console.log("Found images in PDF:", imagesInDocByObjectNumber.size);
  const pdfBytes = await doc.save();
  const f1size = pdf.byteLength / 1024
  const f2size = pdfBytes.byteLength / 1024;
  console.log(`Original PDF size: ${f1size.toFixed(2)}KB`);
  console.log(`Compressed PDF size: ${f2size.toFixed(2)}KB`);
  console.log(`Size difference: ${(f1size - f2size).toFixed(2)}KB`);

  // Save the compressed PDF to a file
  await fs.promises.writeFile(`/tmp/${uuid}_compressed.pdf`, pdfBytes);

  return Buffer.from(pdfBytes)
}

export default compress