#include <node_api.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#import <AppKit/AppKit.h>
#import <CoreGraphics/CoreGraphics.h>

static NSWindow *windowFromHandle(uint64_t bits) {
  void *ptr = (void *)(uintptr_t)bits;
  if (!ptr) return nil;
  @try {
    NSView *view = (__bridge NSView *)ptr;
    if ([view isKindOfClass:[NSView class]]) return view.window;
  } @catch (NSException *e) {
    // fall through
  }
  @try {
    void *inner = *(void **)ptr;
    if (!inner) return nil;
    NSView *view = (__bridge NSView *)inner;
    if ([view isKindOfClass:[NSView class]]) return view.window;
  } @catch (NSException *e) {
    return nil;
  }
  return nil;
}

static int vav_screen_tune_window(uint64_t view_bits) {
  @autoreleasepool {
    NSWindow *window = windowFromHandle(view_bits);
    if (!window) return 1;
    window.animationBehavior = NSWindowAnimationBehaviorNone;
    window.hasShadow = NO;
    window.excludedFromWindowsMenu = YES;
    window.styleMask |= NSWindowStyleMaskNonactivatingPanel;
    window.collectionBehavior |=
        NSWindowCollectionBehaviorIgnoresCycle | NSWindowCollectionBehaviorStationary;
    if ([window isKindOfClass:[NSPanel class]]) {
      NSPanel *panel = (NSPanel *)window;
      panel.becomesKeyOnlyIfNeeded = YES;
      panel.floatingPanel = YES;
    }
    return 0;
  }
}

static int vav_screen_capture(int32_t exclude_pid, const char *out_dir) {
  @autoreleasepool {
    if (!out_dir || !out_dir[0]) return 2;
    NSString *dir = [NSString stringWithUTF8String:out_dir];
    NSError *err = nil;
    if (![[NSFileManager defaultManager] createDirectoryAtPath:dir
                                   withIntermediateDirectories:YES
                                                    attributes:nil
                                                         error:&err]) {
      return 3;
    }

    CFArrayRef info = CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly, kCGNullWindowID);
    if (!info) return 1;
    NSArray<NSDictionary *> *windows = CFBridgingRelease(info);
    CFMutableArrayRef ids = CFArrayCreateMutable(kCFAllocatorDefault, 0, NULL);
    for (NSDictionary *win in windows) {
      int32_t pid = [win[(id)kCGWindowOwnerPID] intValue];
      if (exclude_pid > 0 && pid == exclude_pid) continue;
      CGWindowID wid = (CGWindowID)[win[(id)kCGWindowNumber] unsignedIntValue];
      if (!wid) continue;
      CFArrayAppendValue(ids, (const void *)(uintptr_t)wid);
    }

    NSMutableArray *items = [NSMutableArray array];
    for (NSScreen *screen in [NSScreen screens]) {
      NSNumber *num = screen.deviceDescription[@"NSScreenNumber"];
      if (!num) continue;
      CGDirectDisplayID displayID = num.unsignedIntValue;
      CGRect bounds = CGDisplayBounds(displayID);
      if (bounds.size.width < 8 || bounds.size.height < 8) continue;
      CGImageRef image = CGWindowListCreateImageFromArray(bounds, ids, kCGWindowImageBestResolution);
      if (!image) continue;
      size_t pxW = CGImageGetWidth(image);
      size_t pxH = CGImageGetHeight(image);
      if (pxW < 8 || pxH < 8) {
        CGImageRelease(image);
        continue;
      }
      NSBitmapImageRep *rep = [[NSBitmapImageRep alloc] initWithCGImage:image];
      CGImageRelease(image);
      NSData *png = [rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
      if (!png.length) continue;
      NSString *name = [NSString stringWithFormat:@"d-%u.png", displayID];
      NSString *path = [dir stringByAppendingPathComponent:name];
      if (![png writeToFile:path atomically:YES]) continue;
      [items addObject:@{
        @"displayId" : @(displayID),
        @"path" : path,
        @"width" : @((int)CGRectGetWidth(bounds)),
        @"height" : @((int)CGRectGetHeight(bounds))
      }];
    }
    CFRelease(ids);

    if (items.count == 0) return 1;
    NSData *json = [NSJSONSerialization dataWithJSONObject:items options:0 error:nil];
    if (!json) return 3;
    NSString *manifest = [dir stringByAppendingPathComponent:@"manifest.json"];
    if (![json writeToFile:manifest atomically:YES]) return 3;
    return 0;
  }
}

static napi_value JsCapture(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  napi_get_cb_info(env, info, &argc, args, NULL, NULL);
  int32_t pid = 0;
  napi_get_value_int32(env, args[0], &pid);
  size_t len = 0;
  napi_get_value_string_utf8(env, args[1], NULL, 0, &len);
  char *dir = malloc(len + 1);
  if (!dir) {
    napi_throw_error(env, NULL, "oom");
    return NULL;
  }
  napi_get_value_string_utf8(env, args[1], dir, len + 1, &len);
  int rc = vav_screen_capture(pid, dir);
  free(dir);
  napi_value out;
  napi_create_int32(env, rc, &out);
  return out;
}

static int vav_screen_set_cursor(int32_t kind) {
  @autoreleasepool {
    NSCursor *cursor = kind == 1 ? [NSCursor crosshairCursor] : [NSCursor arrowCursor];
    [cursor set];
    return 0;
  }
}

static napi_value JsTune(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, NULL, NULL);
  void *data = NULL;
  size_t size = 0;
  napi_get_buffer_info(env, args[0], &data, &size);
  uint64_t bits = 0;
  if (data && size >= 8) memcpy(&bits, data, 8);
  else if (data && size >= 4) {
    uint32_t value = 0;
    memcpy(&value, data, 4);
    bits = value;
  }
  int rc = vav_screen_tune_window(bits);
  napi_value out;
  napi_create_int32(env, rc, &out);
  return out;
}

static napi_value JsSetCursor(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, NULL, NULL);
  int32_t kind = 0;
  napi_get_value_int32(env, args[0], &kind);
  int rc = vav_screen_set_cursor(kind);
  napi_value out;
  napi_create_int32(env, rc, &out);
  return out;
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_value capture;
  napi_value tune;
  napi_value setCursor;
  napi_create_function(env, "capture", NAPI_AUTO_LENGTH, JsCapture, NULL, &capture);
  napi_create_function(env, "tune", NAPI_AUTO_LENGTH, JsTune, NULL, &tune);
  napi_create_function(env, "setCursor", NAPI_AUTO_LENGTH, JsSetCursor, NULL, &setCursor);
  napi_set_named_property(env, exports, "capture", capture);
  napi_set_named_property(env, exports, "tune", tune);
  napi_set_named_property(env, exports, "setCursor", setCursor);
  return exports;
}

NAPI_MODULE(vav_screencap, Init)
