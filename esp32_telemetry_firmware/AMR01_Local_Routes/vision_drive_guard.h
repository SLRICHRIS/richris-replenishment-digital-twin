#pragma once
#include <cstdint>
#include <cstring>
#include <cstdlib>
#include <climits>

namespace amr_vision {
struct Command { char boot[33]{},epoch[33]{},route[33]{},op[8]{}; uint32_t seq=0; int left=0,right=0; uint64_t issued=0,expires=0; };
inline bool hex32(const char* s) { if (std::strlen(s)!=32) return false; for(int i=0;i<32;++i) if(!((s[i]>='0'&&s[i]<='9')||(s[i]>='a'&&s[i]<='f'))) return false; return true; }
inline bool number(const char* s,uint64_t& v) {
  if(!*s) return false;
  v=0;
  for(;*s;++s) { if(*s<'0'||*s>'9'||v>(UINT64_MAX-9)/10) return false; v=v*10+uint64_t(*s-'0'); }
  return true;
}
inline bool duty(const char* s,int& v) { bool neg=*s=='-'; uint64_t n=0; if(!number(s+(neg?1:0),n)||n>255) return false; v=neg?-int(n):int(n); return true; }
// Pass only the authenticated portion, after constant-time HMAC validation.
inline bool parse(char* body,Command& c) {
  char* f[10]; int n=0; f[n++]=body;
  for(char* p=body;*p;++p) if(*p=='|') { *p=0; if(n>=10) return false; f[n++]=p+1; }
  uint64_t seq=0;
  if(n!=10||std::strcmp(f[0],"V1")||!hex32(f[1])||!hex32(f[2])||!hex32(f[3])||!number(f[4],seq)||seq==0||seq>UINT32_MAX||
      (std::strcmp(f[5],"arm")&&std::strcmp(f[5],"drive")&&std::strcmp(f[5],"stop"))||!duty(f[6],c.left)||!duty(f[7],c.right)||!number(f[8],c.issued)||!number(f[9],c.expires)) return false;
  if(std::strcmp(f[5],"drive")&&(c.left||c.right)) return false;
  std::strcpy(c.boot,f[1]); std::strcpy(c.epoch,f[2]); std::strcpy(c.route,f[3]); std::strcpy(c.op,f[5]); c.seq=uint32_t(seq); return true;
}
class Guard {
 public:
  char boot[33]{},epoch[33]{},route[33]{};
  uint32_t seq=0; int left=0,right=0; const char* state="idle"; bool active=false;
  void connection(const char* b,const char* e) { stop("unavailable"); std::strcpy(boot,b); std::strcpy(epoch,e); route[0]=0; seq=0; }
  void stop(const char* reason) { left=right=0; active=false; state=reason; }
  bool accept(const Command& c,uint64_t utc,uint64_t mono,bool ready,int cap) {
    if(!ready||std::strcmp(c.boot,boot)||std::strcmp(c.epoch,epoch)||c.seq<=seq||c.expires<=utc||c.expires-c.issued>500||c.issued>utc+100||c.issued+500<utc||c.expires<c.issued||std::abs(c.left)>cap||std::abs(c.right)>cap) return false;
    if(!std::strcmp(c.op,"arm")) {
      if(active||!std::strcmp(c.route,route)) return false;
      std::strcpy(route,c.route); active=true; left=right=0; targetLeft=targetRight=0; state="armed";
    } else {
      if(!active||std::strcmp(c.route,route)) return false;
      if(!std::strcmp(c.op,"stop")) stop("stopped");
      else { targetLeft=c.left; targetRight=c.right; }
    }
    seq=c.seq; deadline=mono+(c.expires-utc)*1000; return true;
  }
  void tick(uint64_t mono,bool ready) {
    if(!ready) { stop("unavailable"); return; }
    if(!active) return;
    if(mono>=deadline) { stop("expired"); return; }
    const int ls=(targetLeft>0)-(targetLeft<0),rs=(targetRight>0)-(targetRight<0);
    if((ls&&lastLeft&&ls!=lastLeft)||(rs&&lastRight&&rs!=lastRight)) {
      left=right=0; interlockUntil=mono+150000; lastLeft=ls; lastRight=rs; state="interlock";
    }
    if(mono<interlockUntil) return;
    left=targetLeft; right=targetRight;
    if(ls) lastLeft=ls;
    if(rs) lastRight=rs;
    if(left||right) state="moving";
    else if(std::strcmp(state,"armed")) state="interlock";
  }
 private:
  uint64_t deadline=0,interlockUntil=0; int targetLeft=0,targetRight=0,lastLeft=0,lastRight=0;
};
}
