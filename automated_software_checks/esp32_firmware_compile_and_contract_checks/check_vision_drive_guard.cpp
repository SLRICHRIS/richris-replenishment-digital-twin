#include <cassert>
#include <cstring>
#include "vision_drive_guard.h"
using namespace amr_vision;
Command command(const char* route,const char* op,int l,int r,uint32_t seq,uint64_t now) {
 Command c; std::strcpy(c.boot,"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");std::strcpy(c.epoch,"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");std::strcpy(c.route,route);std::strcpy(c.op,op);c.left=l;c.right=r;c.seq=seq;c.issued=now;c.expires=now+500;return c;
}
int main() {
 Guard g;const char* route="cccccccccccccccccccccccccccccccc";
 g.connection("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
 auto c=command(route,"drive",20,20,1,1000);assert(!g.accept(c,1000,0,true,60));
 c=command(route,"arm",0,0,1,1000);assert(!g.accept(c,1000,0,false,60));assert(g.accept(c,1000,0,true,60));g.tick(1000,true);assert(g.active&&g.left==0);
 assert(!g.accept(c,1000,2000,true,60));
 c=command(route,"drive",30,20,2,1100);assert(g.accept(c,1100,100000,true,60));g.tick(100000,true);assert(g.left==30&&g.right==20);
 c=command(route,"drive",-20,20,3,1200);assert(g.accept(c,1200,200000,true,60));g.tick(200000,true);assert(g.left==0&&g.right==0);g.tick(349999,true);assert(!g.left);g.tick(350000,true);assert(g.left==-20&&g.right==20);
 g.tick(700000,true);assert(!g.active&&g.left==0&&!std::strcmp(g.state,"expired"));
 c=command(route,"drive",20,20,4,1800);assert(!g.accept(c,1800,800000,true,60));
 c=command(route,"arm",0,0,4,1800);assert(!g.accept(c,1800,800000,true,60));
 c=command("dddddddddddddddddddddddddddddddd","arm",0,0,4,1800);assert(g.accept(c,1800,800000,true,60));
 c=command("dddddddddddddddddddddddddddddddd","drive",61,20,5,1900);assert(!g.accept(c,1900,900000,true,60));
 c.left=20;assert(!g.accept(c,2500,900000,true,60));
 c.issued=3000;c.expires=3500;assert(!g.accept(c,1900,900000,true,60));
 g.tick(900000,false);assert(!g.active&&g.left==0);
 g.connection("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee");
 c=command(route,"arm",0,0,10,2000);assert(!g.accept(c,2000,1000000,true,60));
 char body[]="V1|aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa|bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb|cccccccccccccccccccccccccccccccc|17|drive|-20|30|1000|1500";
 Command parsed;assert(parse(body,parsed)&&parsed.left==-20&&parsed.seq==17);
 char bad[]="V1|aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa|bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb|cccccccccccccccccccccccccccccccc|17|drive|-|30|1000|1500";
 assert(!parse(bad,parsed));
}
