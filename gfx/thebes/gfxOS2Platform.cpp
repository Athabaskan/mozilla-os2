/* vim: set sw=4 sts=4 et cin: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include <os2.h>
#include <cairo-os2.h>
#include "cairo-ft.h" // includes fontconfig.h, too

#include "gfxOS2Platform.h"
#include "gfxOS2Surface.h"
#include "gfxImageSurface.h"
#include "gfxOS2Fonts.h"
#include "nsTArray.h"
#include "nsServiceManagerUtils.h"

#include "gfxFontconfigUtils.h"
//#include <fontconfig/fontconfig.h>

/**********************************************************************
 * class gfxOS2Platform
 **********************************************************************/
gfxFontconfigUtils *gfxOS2Platform::sFontconfigUtils = nullptr;

gfxOS2Platform::gfxOS2Platform()
{
    cairo_os2_init();

    if (!sFontconfigUtils) {
        sFontconfigUtils = gfxFontconfigUtils::GetFontconfigUtils();
    }
}

gfxOS2Platform::~gfxOS2Platform()
{
    gfxFontconfigUtils::Shutdown();
    sFontconfigUtils = nullptr;

    // Clean up cairo_os2 sruff.
    cairo_os2_surface_enable_dive(false, false);
    cairo_os2_fini();
}

already_AddRefed<gfxASurface>
gfxOS2Platform::CreateOffscreenSurface(const gfxIntSize& aSize,
                                       gfxASurface::gfxContentType contentType)
{
    gfxASurface::gfxImageFormat format =
        OptimalFormatForContent(contentType);
    int stride =
        cairo_format_stride_for_width(static_cast<cairo_format_t>(format),
                                      aSize.width);

    // To avoid memory fragmentation, return a standard image surface
    // for small images (32x32x4 or 64x64x1).  Their bitmaps will be
    // be allocated from libc's heap rather than system memory.

    gfxASurface* surf;
    if (stride * aSize.height <= 4096) {
        surf = new gfxImageSurface(aSize, format);
    } else {
        surf = new gfxOS2Surface(aSize, format);
    }

    NS_IF_ADDREF(surf);
    return surf;
}

nsresult
gfxOS2Platform::GetFontList(nsIAtom *aLangGroup,
                            const nsACString& aGenericFamily,
                            nsTArray<nsString>& aListOfFonts)
{
#ifdef DEBUG_thebes
    const char *langgroup = "(null)";
    if (aLangGroup) {
        aLangGroup->GetUTF8String(&langgroup);
    }
    char *family = ToNewCString(aGenericFamily);
    printf("gfxOS2Platform::GetFontList(%s, %s, ..)\n",
           langgroup, family);
    free(family);
#endif
    return sFontconfigUtils->GetFontList(aLangGroup, aGenericFamily,
                                         aListOfFonts);
}

nsresult gfxOS2Platform::UpdateFontList()
{
#ifdef DEBUG_thebes
    printf("gfxOS2Platform::UpdateFontList()\n");
#endif
    mCodepointsWithNoFonts.reset();

    nsresult rv = sFontconfigUtils->UpdateFontList();

    // initialize ranges of characters for which system-wide font search should be skipped
    mCodepointsWithNoFonts.SetRange(0,0x1f);     // C0 controls
    mCodepointsWithNoFonts.SetRange(0x7f,0x9f);  // C1 controls
    return rv;
}

nsresult
gfxOS2Platform::ResolveFontName(const nsAString& aFontName,
                                FontResolverCallback aCallback,
                                void *aClosure, bool& aAborted)
{
#ifdef DEBUG_thebes
    char *fontname = ToNewCString(aFontName);
    printf("gfxOS2Platform::ResolveFontName(%s, ...)\n", fontname);
    free(fontname);
#endif
    return sFontconfigUtils->ResolveFontName(aFontName, aCallback, aClosure,
                                             aAborted);
}

nsresult
gfxOS2Platform::GetStandardFamilyName(const nsAString& aFontName, nsAString& aFamilyName)
{
    return sFontconfigUtils->GetStandardFamilyName(aFontName, aFamilyName);
}

gfxFontGroup *
gfxOS2Platform::CreateFontGroup(const nsAString &aFamilies,
                const gfxFontStyle *aStyle,
                gfxUserFontSet *aUserFontSet)
{
    return new gfxOS2FontGroup(aFamilies, aStyle, aUserFontSet);
}

already_AddRefed<gfxOS2Font>
gfxOS2Platform::FindFontForChar(uint32_t aCh, gfxOS2Font *aFont)
{
#ifdef DEBUG_thebes
    printf("gfxOS2Platform::FindFontForChar(%d, ...)\n", aCh);
#endif

    // is codepoint with no matching font? return null immediately
    if (mCodepointsWithNoFonts.test(aCh)) {
        return nullptr;
    }

    // the following is not very clever but it's a quick fix to search all fonts
    // (one should instead cache the charmaps as done on Mac and Win)

    // just continue to append all fonts known to the system
    nsTArray<nsString> fontList;
    nsAutoCString generic;
    nsresult rv = GetFontList(aFont->GetStyle()->language, generic, fontList);
    if (NS_SUCCEEDED(rv)) {
        // start at 3 to skip over the generic entries
        for (uint32_t i = 3; i < fontList.Length(); i++) {
#ifdef DEBUG_thebes
            printf("searching in entry i=%d (%s)\n",
                   i, NS_LossyConvertUTF16toASCII(fontList[i]).get());
#endif
            nsRefPtr<gfxOS2Font> font =
                gfxOS2Font::GetOrMakeFont(fontList[i], aFont->GetStyle());
            if (!font)
                continue;
            FT_Face face = cairo_ft_scaled_font_lock_face(font->CairoScaledFont());
            if (!face || !face->charmap) {
                if (face)
                    cairo_ft_scaled_font_unlock_face(font->CairoScaledFont());
                continue;
            }

            FT_UInt gid = FT_Get_Char_Index(face, aCh); // find the glyph id
            if (gid != 0) {
                // this is the font
                cairo_ft_scaled_font_unlock_face(font->CairoScaledFont());
                return font.forget();
            }
        }
    }

    // no match found, so add to the set of non-matching codepoints
    mCodepointsWithNoFonts.set(aCh);
    return nullptr;
}
