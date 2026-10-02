#ifndef MASAKA_DOWNLOAD_BUDGET_H
#define MASAKA_DOWNLOAD_BUDGET_H
#include <stdbool.h>
#include <stdint.h>
#include <string.h>

#define MASAKA_DOWNLOAD_MAX_FILES 100u
#define MASAKA_DOWNLOAD_MAX_FILE_BYTES (UINT64_C(4) * 1024 * 1024)
#define MASAKA_DOWNLOAD_MAX_SESSION_BYTES (UINT64_C(64) * 1024 * 1024)
typedef struct { unsigned int started; uint64_t received; } MasakaDownloadBudget;

static inline bool masaka_download_admit(MasakaDownloadBudget *budget) {
    if (budget->started >= MASAKA_DOWNLOAD_MAX_FILES || budget->received >= MASAKA_DOWNLOAD_MAX_SESSION_BYTES) return false;
    budget->started++;
    return true;
}
static inline bool masaka_download_name_valid(const char *name) {
    if (!name) return false;
    size_t size = strnlen(name, 201);
    if (!size || size > 200 || !strcmp(name, ".") || !strcmp(name, "..")) return false;
    for (size_t i = 0; i < size; i++) {
        unsigned char c = (unsigned char)name[i];
        if (c < 32 || c == 127 || c == '/' || c == '\\') return false;
    }
    return true;
}
static inline uint64_t masaka_saturating_add(uint64_t a, uint64_t b) {
    return b > UINT64_MAX - a ? UINT64_MAX : a + b;
}
// received-data is delivered after bytes arrive. These are cancellation
// thresholds, NOT filesystem quotas or a promise of zero overshoot.
static inline bool masaka_download_receive(MasakaDownloadBudget *budget, uint64_t *file_bytes, uint64_t bytes) {
    *file_bytes = masaka_saturating_add(*file_bytes, bytes);
    budget->received = masaka_saturating_add(budget->received, bytes);
    return *file_bytes <= MASAKA_DOWNLOAD_MAX_FILE_BYTES && budget->received <= MASAKA_DOWNLOAD_MAX_SESSION_BYTES;
}
#endif
