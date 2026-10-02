#define _POSIX_C_SOURCE 200809L
#include <assert.h>
#include "download-budget.h"
int main(void) {
    MasakaDownloadBudget budget = {0};
    for (unsigned int i = 0; i < 100; i++) assert(masaka_download_admit(&budget));
    assert(!masaka_download_admit(&budget));assert(budget.started == 100);
    assert(masaka_download_name_valid("报告.txt"));
    const char *bad[] = {NULL,"",".","..","../escape","a/b","a\\b","new\nline","\177"};
    for (size_t i = 0; i < sizeof(bad)/sizeof(bad[0]); i++) assert(!masaka_download_name_valid(bad[i]));
    char name[202];memset(name,'x',200);name[200]=0;assert(masaka_download_name_valid(name));
    name[200]='x';name[201]=0;assert(!masaka_download_name_valid(name));
    budget=(MasakaDownloadBudget){0};uint64_t file=0;
    assert(masaka_download_receive(&budget,&file,MASAKA_DOWNLOAD_MAX_FILE_BYTES));
    assert(!masaka_download_receive(&budget,&file,1));
    budget=(MasakaDownloadBudget){.received=MASAKA_DOWNLOAD_MAX_SESSION_BYTES-1};file=0;
    assert(masaka_download_receive(&budget,&file,1));assert(!masaka_download_admit(&budget));
    assert(!masaka_download_receive(&budget,&file,1));
    budget=(MasakaDownloadBudget){.received=UINT64_MAX-1};file=UINT64_MAX-1;
    assert(!masaka_download_receive(&budget,&file,10));assert(file==UINT64_MAX);assert(budget.received==UINT64_MAX);
    return 0;
}
