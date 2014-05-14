/**
 * Handling native paths.
 *
 * This module contains a number of functions destined to simplify
 * working with native paths through a cross-platform API. Functions
 * of this module will only work with the following assumptions:
 *
 * - paths are valid;
 * - paths are defined with one of the grammars that this module can
 *   parse (see later);
 * - all path concatenations go through function |join|.
 *
 * This implementation is a slight modification of ospath_win_back.jsm and
 * must be updated whenever that module changes. The main difference is that
 * on OS/2 we have to support both "\" (native style) and "/" (Unix style)
 * as path separators because OS/2 uses kLIBC which pretends to be Posix and
 * may emit Unix style separators.
 */
if (typeof Components != "undefined") {
  this.EXPORTED_SYMBOLS = ["OS"];
  let Scope = {};
  Components.utils.import("resource://gre/modules/Services.jsm", Scope);

  // Some tests need to import this module from any platform.
  // We detect this by setting a bogus preference "toolkit.osfile.test.syslib_necessary"
  // from the test suite
  let syslib_necessary = true;
  try {
    syslib_necessary = Scope.Services.prefs.getBoolPref("toolkit.osfile.test.syslib_necessary");
  } catch (x) {
    // Ignore errors
  }

  try {
    Components.utils.import("resource://gre/modules/osfile/osfile_unix_allthreads.jsm", this);
  } catch (ex if !syslib_necessary && ex.message.startsWith("Could not open system library:")) {
    // Executing this module without a libc is acceptable for this test
  }
}
(function(exports) {
   "use strict";
   if (!exports.OS) {
     exports.OS = {};
   }
   if (!exports.OS.OS2) {
     exports.OS.OS2 = {};
   }
   if (exports.OS.OS2.Path) {
     return; // Avoid double-initialization
   }

   exports.OS.OS2.Path = {
     /**
      * Return the final part of the path.
      * The final part of the path is everything after the last "\\".
      */
     basename: function basename(path) {
       if (path.startsWith("\\\\") || path.startsWith("//")) {
         // UNC-style path
         let index = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
         if (index != 1) {
           return path.slice(index + 1);
         }
         return ""; // Degenerate case
       }
       return path.slice(Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"),
                                  path.lastIndexOf(":")) + 1);
     },

     /**
      * Return the directory part of the path.
      *
      * If the path contains no directory, return the drive letter,
      * or "." if the path contains no drive letter or if option
      * |os2NoDrive| is set.
      *
      * Otherwise, return everything before the last backslash,
      * including the drive/server name.
      *
      *
      * @param {string} path The path.
      * @param {*=} options Platform-specific options controlling the behavior
      * of this function. This implementation supports the following options:
      *  - |os2NoDrive| If |true|, also remove the letter from the path name.
      */
     dirname: function dirname(path, options) {
       let noDrive = (options && options.os2NoDrive);

       // Find the last occurrence of "\\"
       let index = path.lastIndexOf("\\") || path.lastIndexOf("/");
       if (index == -1) {
         // If there is no directory component...
         if (!noDrive) {
           // Return the drive path if possible, falling back to "."
           return this.os2GetDrive(path) || ".";
         } else {
           // Or just "."
           return ".";
         }
       }

       if (index == 1 && (path.charAt(0) == "\\" || path.charAt(0) == "/")) {
         // The path is reduced to a UNC drive
         if (noDrive) {
           return ".";
         } else {
           return path;
         }
       }

       // Ignore any occurrence of "\\: immediately before that one
       while (index >= 0 && (path[index] == "\\" || path[index] == "/")) {
         --index;
       }

       // Compute what is left, removing the drive name if necessary
       let start;
       if (noDrive) {
         start = (this.os2GetDrive(path) || "").length;
       } else {
         start = 0;
       }
       return path.slice(start, index + 1);
     },

     /**
      * Join path components.
      * This is the recommended manner of getting the path of a file/subdirectory
      * in a directory.
      *
      * Example: Obtaining $TMP/foo/bar in an OS-independent manner
      *  var tmpDir = OS.Constants.Path.tmpDir;
      *  var path = OS.Path.join(tmpDir, "foo", "bar");
      *
      * Under Windows, this will return "$TMP\foo\bar".
      */
     join: function join(path /*...*/) {
       let paths = [];
       let root;
       let absolute = false;
       for each(let subpath in arguments) {
         let drive = this.os2GetDrive(subpath);
         let abs   = this.os2IsAbsolute(subpath);
         if (drive) {
           root = drive;
           let component = trimBackslashes(subpath.slice(drive.length));
           if (component) {
             paths = [component];
           } else {
             paths = [];
           }
           absolute = abs;
         } else if (abs) {
           paths = [trimBackslashes(subpath)];
           absolute = true;
         } else {
           paths.push(trimBackslashes(subpath));
         }
       }
       let result = "";
       if (root) {
         result += root;
       }
       if (absolute) {
         result += "\\";
       }
       result += paths.join("\\");
       return result;
     },

     /**
      * Return the drive name of a path, or |null| if the path does
      * not contain a drive name.
      *
      * Drive name appear either as "DriveName:..." (the return drive
      * name includes the ":") or "\\\\DriveName..." (the returned drive name
      * includes "\\\\").
      */
     os2GetDrive: function os2GetDrive(path) {
       if (path.startsWith("\\\\") || path.startsWith("//")) {
         // UNC path
         if (path.length == 2) {
           return null;
         }
         let index = Math.min(path.indexOf("\\", 2), path.indexOf("/", 2));
         if (index == -1) {
           return path;
         }
         return path.slice(0, index);
       }
       // Non-UNC path
       let index = path.indexOf(":");
       if (index <= 0) return null;
       return path.slice(0, index + 1);
     },

     /**
      * Return |true| if the path is absolute, |false| otherwise.
      *
      * We consider that a path is absolute if it starts with "\\"
      * or "driveletter:\\".
      */
     os2IsAbsolute: function os2IsAbsolute(path) {
       let index = path.indexOf(":");
       return path.length > index + 1 && (path[index + 1] == "\\" || path[index + 1] == "/");
     },

     /**
      * Normalize a path by removing any unneeded ".", "..", "\\".
      * Also convert any "/" to a "\\".
      */
     normalize: function normalize(path) {
       let stack = [];

       // Remove the drive (we will put it back at the end)
       let root = this.os2GetDrive(path);
       if (root) {
         path = path.slice(root.length);
       }

       // Remember whether we need to restore a leading "\\" or drive name.
       let absolute = this.os2IsAbsolute(path);

       // Normalize "/" to "\\"
       path = path.replace("/", "\\");

       // And now, fill |stack| from the components,
       // popping whenever there is a ".."
       path.split("\\").forEach(function loop(v) {
         switch (v) {
         case "":  case ".": // Ignore
           break;
         case "..":
           if (stack.length == 0) {
             if (absolute) {
               throw new Error("Path is ill-formed: attempting to go past root");
             } else {
              stack.push("..");
             }
           } else {
             if (stack[stack.length - 1] == "..") {
               stack.push("..");
             } else {
               stack.pop();
             }
           }
           break;
         default:
           stack.push(v);
         }
       });

       // Put everything back together
       let result = stack.join("\\");
       if (absolute) {
         result = "\\" + result;
       }
       if (root) {
         result = root + result;
       }
       return result;
     },

     /**
      * Return the components of a path.
      * You should generally apply this function to a normalized path.
      *
      * @return {{
      *   {bool} absolute |true| if the path is absolute, |false| otherwise
      *   {array} components the string components of the path
      *   {string?} os2Drive the drive or server for this path
      * }}
      *
      * Other implementations may add additional OS-specific informations.
      */
     split: function split(path) {
       return {
         absolute: this.os2IsAbsolute(path),
         os2Drive: this.os2GetDrive(path),
         components: path.replace("/", "\\").split("\\")
       };
     }
   };

    /**
     * Utility function: Remove any leading/trailing backslashes
     * from a string.
     */
    let trimBackslashes = function trimBackslashes(string) {
      return string.replace(/^\\+|\\+$/g,'');
    };

   exports.OS.Path = exports.OS.OS2.Path;
}(this));
