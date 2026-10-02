/* Isolated ABI probe, NOT production integration. Compile against GLib only;
 * resolve the public WebKit API already loaded by MiniBrowser. */
#define _GNU_SOURCE
#include <glib-object.h>
#include <glib/gstdio.h>
#include <dlfcn.h>
#include <stdio.h>
#include <unistd.h>
#include <string.h>
#include "download-budget.h"

typedef struct { char *id; gboolean failed; guint64 bytes; } Record;
static char *root;
static FILE *journal;
static MasakaDownloadBudget budget;
static void (*set_destination)(gpointer, const char *);
static void (*set_overwrite)(gpointer, gboolean);
static void (*cancel_download)(gpointer);

static void record_free(gpointer pointer) {
    Record *r = pointer; g_free(r->id); g_free(r);
}
static void emit(const char *event, Record *r) {
    fprintf(journal, "%s\t%s\t%" G_GUINT64_FORMAT "\t%d\n", event, r->id, r->bytes, r->failed);
    fflush(journal);
}
static gboolean destination(gpointer download, const char *suggested, gpointer data) {
    Record *r = data;
    if (!masaka_download_name_valid(suggested) || !g_utf8_validate(suggested, -1, NULL)) {
        r->failed = TRUE; cancel_download(download); return TRUE;
    }
    char *path = g_build_filename(root, r->id, NULL);
    /* The untrusted suggested filename never participates in physical paths. */
    char *encoded = g_base64_encode((const guchar *)suggested, strlen(suggested));
    fprintf(journal, "name\t%s\t%s\n", r->id, encoded); fflush(journal);
    set_overwrite(download, FALSE);
    set_destination(download, path);
    g_free(encoded); g_free(path);
    emit("destination", r);
    return TRUE;
}
static void received(gpointer download, guint64 bytes, gpointer data) {
    Record *r = data;
    uint64_t total = r->bytes;
    gboolean allowed = masaka_download_receive(&budget, &total, bytes);
    r->bytes = total;
    if (!allowed && !r->failed) { r->failed = TRUE; cancel_download(download); }
}
static void failed(gpointer download, GError *error, gpointer data) {
    (void)download; (void)error;
    Record *r = data; r->failed = TRUE; emit("failed", r);
}
static void finished(gpointer download, gpointer data) {
    (void)download; emit("finished", data);
}
static gboolean started(GSignalInvocationHint *hint, guint count, const GValue *values, gpointer data) {
    (void)hint; (void)data;
    if (count != 2) return TRUE;
    gpointer download = g_value_get_object(&values[1]);
    if (!masaka_download_admit(&budget)) { cancel_download(download); return TRUE; }
    Record *r = g_new0(Record, 1); r->id = g_uuid_string_random();
    g_object_set_data_full(download, "masaka-probe-record", r, record_free);
    g_signal_connect(download, "decide-destination", G_CALLBACK(destination), r);
    g_signal_connect(download, "received-data", G_CALLBACK(received), r);
    g_signal_connect(download, "failed", G_CALLBACK(failed), r);
    g_signal_connect(download, "finished", G_CALLBACK(finished), r);
    emit("started", r);
    return TRUE;
}
static gboolean install(gpointer data) {
    (void)data;
    GType (*get_type)(void) = dlsym(RTLD_DEFAULT, "webkit_network_session_get_type");
    set_destination = dlsym(RTLD_DEFAULT, "webkit_download_set_destination");
    set_overwrite = dlsym(RTLD_DEFAULT, "webkit_download_set_allow_overwrite");
    cancel_download = dlsym(RTLD_DEFAULT, "webkit_download_cancel");
    if (!get_type || !set_destination || !set_overwrite || !cancel_download) _exit(90);
    const char *token = g_getenv("MASAKA_DOWNLOAD_TOKEN");
    if (token) {
        if (!g_uuid_string_is_valid(token)) _exit(94);
        root = g_strconcat("/var/lib/masaka-downloads/", token, NULL);
        /* Refuse reuse, including symlinks and prior launch directories. */
        if (g_mkdir(root, 0750)) _exit(91);
    } else {
        root = g_strdup("/home/browser/masaka-native-XXXXXX");
        if (!g_mkdtemp(root)) _exit(91);
    }
    char *path = g_build_filename(root, "events.tsv", NULL);
    journal = g_fopen(path, "wx"); g_free(path);
    if (!journal) _exit(92);
    GType type = get_type(); gpointer klass = g_type_class_ref(type);
    guint signal = g_signal_lookup("download-started", type);
    if (!signal || !g_signal_add_emission_hook(signal, 0, started, NULL, NULL)) _exit(93);
    g_type_class_unref(klass);
    fprintf(journal, "ready\n"); fflush(journal);
    return G_SOURCE_REMOVE;
}
__attribute__((constructor)) static void initialize(void) {
    char exe[4096]; ssize_t length = readlink("/proc/self/exe", exe, sizeof(exe)-1);
    if (length <= 0) return;
    exe[length] = 0;
    const char *name = strrchr(exe, '/');
    if (!name || strcmp(name + 1, "MiniBrowser.masaka-download-original")) return;
    g_idle_add(install, NULL);
}
