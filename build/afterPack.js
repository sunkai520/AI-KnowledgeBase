const path = require('path');
const fs = require('fs');

/**
 * afterPack: embed icon + version info into SKDAI.exe using resedit.
 * resedit calls Windows UpdateResource API directly, works on large PE files
 * where rcedit (custom PE writer) fails with "Unable to commit changes".
 */
module.exports = async (context) => {
  if (process.platform !== 'win32') return;

  const { appOutDir, packager } = context;
  const executableName = packager.platformSpecificBuildOptions.executableName || packager.appInfo.productFilename;
  const exePath  = path.join(appOutDir, `${executableName}.exe`);
  const iconPath = path.join(__dirname, 'icon.ico');

  if (!fs.existsSync(exePath))  { console.warn('  • afterPack: exe not found, skip'); return; }
  if (!fs.existsSync(iconPath)) { console.warn('  • afterPack: icon.ico not found, skip'); return; }

  let resedit;
  try {
    resedit = require('resedit');
  } catch (e) {
    console.warn('  • afterPack: resedit not found, skip:', e.message);
    return;
  }

  console.log('  • afterPack: embedding icon + version info via resedit...');

  try {
    const exeData  = fs.readFileSync(exePath);
    const icoData  = fs.readFileSync(iconPath);

    const exe = resedit.NtExecutable.from(exeData, { ignoreCert: true });
    const res = resedit.NtExecutableResource.from(exe);

    // --- set icon ---
    const iconFile = resedit.Data.IconFile.from(icoData);
    resedit.Resource.IconGroupEntry.replaceIconsForResource(
      res.entries,
      1,    // icon group ID (same as Electron default)
      1033, // en-US
      iconFile.icons.map(i => i.data)
    );

    // --- set version info ---
    const { productName, version } = packager.appInfo;
    const description = packager.config.description || productName;
    const copyright   = packager.config.copyright   || '';
    const company     = typeof packager.config.author === 'string'
      ? packager.config.author
      : (packager.config.author && packager.config.author.name) || '';

    const viList = resedit.Resource.VersionInfo.fromEntries(res.entries);
    let vi = viList[0];
    if (!vi) {
      vi = resedit.Resource.VersionInfo.createEmpty();
      viList.push(vi);
    }

    const parseVer = (v) => v.split('.').map(Number).concat([0,0,0,0]).slice(0,4);
    const [fMaj, fMin, fPat, fBld] = parseVer(version);

    vi.fixedInfo.fileVersionMS = (fMaj << 16) | fMin;
    vi.fixedInfo.fileVersionLS = (fPat << 16) | fBld;
    vi.fixedInfo.productVersionMS = (fMaj << 16) | fMin;
    vi.fixedInfo.productVersionLS = (fPat << 16) | fBld;

    vi.setStringValues(
      { lang: 1033, codepage: 1200 },
      {
        ProductName:      productName,
        FileDescription:  description,
        CompanyName:      company,
        LegalCopyright:   copyright,
        FileVersion:      version,
        ProductVersion:   version,
        InternalName:     executableName,
        OriginalFilename: `${executableName}.exe`,
      }
    );

    vi.outputToResourceEntries(res.entries);

    // write back
    res.outputResource(exe);
    const newBuf = Buffer.from(exe.generate());
    fs.writeFileSync(exePath, newBuf);

    console.log(`  • afterPack: done (${(newBuf.length / 1024 / 1024).toFixed(1)} MB)`);
  } catch (err) {
    console.error('  • afterPack: resedit failed:', err.message);
  }
};
