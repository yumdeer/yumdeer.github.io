INSERT INTO articles (slug, collection, title, description, body_md, pub_date, draft, created_at, updated_at)
VALUES ('回答-2019', 'photography', '回 答', NULL, '**我不知道！**

![](/api/media/img/legacy/world.jpg)

   《 回答 》
       北岛
卑鄙是卑鄙者的通行证，
高尚是高尚者的墓志铭，
看吧，在那镀金的天空中，
飘满了死者弯曲的倒影。

冰川纪过去了，
为什么到处都是冰凌？
好望角发现了，
为什么死海里千帆相竞？

我来到这个世界上，
只带着纸、绳索和身影，
为了在审判之前，
宣读那些被判决的声音。

告诉你吧，世界
我–不–相–信！
纵使你脚下有一千名挑战者，
那就把我算作第一千零一名。

我不相信天是蓝的，
我不相信雷的回声，
我不相信梦是假的，
我不相信死无报应。

如果海洋注定要决堤，
就让所有的苦水都注入我心中，
如果陆地注定要上升，
就让人类重新选择生存的峰顶。

新的转机和闪闪星斗，
正在缀满没有遮拦的天空。
那是五千年的象形文字，
那是未来人们凝视的眼睛。', '2019-04-22', 0, datetime('now'), datetime('now'))
ON CONFLICT(slug) DO UPDATE SET body_md=excluded.body_md, title=excluded.title, pub_date=excluded.pub_date, updated_at=datetime('now');
INSERT INTO articles (slug, collection, title, description, body_md, pub_date, draft, created_at, updated_at)
VALUES ('花寻鹿的栖息地-2019', 'photography', '花寻鹿的栖息地', NULL, '[![](https://s3.ax1x.com/2021/01/09/sQMe1O.png)](https://imgchr.com/i/sQMe1O)

**<font face="黑体" size="2">李白</font>   犬吠水声中，桃花带雨浓。   树深时见鹿，溪午不闻钟。   野竹分青霭，飞泉挂碧峰。   无人知所去，愁倚两三松。**', '2019-04-22', 0, datetime('now'), datetime('now'))
ON CONFLICT(slug) DO UPDATE SET body_md=excluded.body_md, title=excluded.title, pub_date=excluded.pub_date, updated_at=datetime('now');
INSERT INTO articles (slug, collection, title, description, body_md, pub_date, draft, created_at, updated_at)
VALUES ('故乡-2019', 'photography', '故 乡', NULL, '[![](https://s3.ax1x.com/2021/01/09/sQMmcD.jpg)](https://imgchr.com/i/sQMmcD)

<iframe frameborder="no" border="0" marginwidth="0" marginheight="0" width="330" height="86" src="//music.163.com/outchain/player?type=2&id=92224&auto=1&height=66">
</iframe>

今天又看了一遍”经典咏流传”，听了一遍胡老爷子的“乡愁四韵”，在他乡平添一种别样的感觉。

饮一瓢长江水，品一屡腊梅香。醉倒在这长江水中，梦到回到母亲的怀抱。胡老是台湾原住民，來自大武山、拥有卑南族及排灣族血統，是真正的大山的孩子。他本人也曾在节目说过”我只是一個山上的孩子，我只能用歌說話”。《橄榄树》、《太平洋的风》、《牛背上的小孩》都是胡老的作品，其中流露出老爷自细腻真诚，置身其中，难免让人置身于牧场，躺在树下，望着远方奔跑的牛儿，此时远处刮来一阵风，你能嗅到其中海风咸腥的气息。', '2019-05-20', 0, datetime('now'), datetime('now'))
ON CONFLICT(slug) DO UPDATE SET body_md=excluded.body_md, title=excluded.title, pub_date=excluded.pub_date, updated_at=datetime('now');
INSERT INTO articles (slug, collection, title, description, body_md, pub_date, draft, created_at, updated_at)
VALUES ('回到童年-2019', 'photography', '回 到 童 年', NULL, '六一儿童节，节日快乐！👶

![](http://tva1.sinaimg.cn/large/0060lm7Tly1g3m2wkfxy1j30t80l6dix.jpg)

<iframe frameborder="no" border="0" marginwidth="0" marginheight="0" width="330" height="86" src="//music.163.com/outchain/player?type=2&id=28481105&auto=1&height=66"></iframe>

六月天微蓝，夜不在寂静，伴随着一场细雨，屋后响起了青蛙的鸣叫。回到童年，记得每个停电的夜晚，我们躲猫猫在田间，在树后，在你的影子里。听着蟋蟀的鸣叫，看见星星的闪光。爸爸说，天上有好多星，地上就有好多人，每個人都是天上的一顆星。

六月，带来了炎热与快乐，总是习惯在地上铺上竹席，手摇着蒲扇，安静的躺在地上，无聊就看看电视。那时候总是有大家交换的光碟，虽然可能总是不完整，但谁在意呢。

学会长大，但请保持童真👩‍🚀。', '2019-06-01', 0, datetime('now'), datetime('now'))
ON CONFLICT(slug) DO UPDATE SET body_md=excluded.body_md, title=excluded.title, pub_date=excluded.pub_date, updated_at=datetime('now');
INSERT INTO articles (slug, collection, title, description, body_md, pub_date, draft, created_at, updated_at)
VALUES ('夜归沉，梦旧人-2021', 'photography', '夜归沉，梦旧人', NULL, '[![](https://s3.ax1x.com/2021/01/09/sMxGse.jpg)](https://imgchr.com/i/sMxGse)

<iframe frameborder="no" border="0" marginwidth="0" marginheight="0" width="330" height="86" src="//music.163.com/outchain/player?type=2&id=520068716&auto=1&height=66"></iframe>

王尔德，My wallpaper and i are fighting a duel to death. One or the other has to go.', '2021-01-08', 0, datetime('now'), datetime('now'))
ON CONFLICT(slug) DO UPDATE SET body_md=excluded.body_md, title=excluded.title, pub_date=excluded.pub_date, updated_at=datetime('now');
INSERT INTO articles (slug, collection, title, description, body_md, pub_date, draft, created_at, updated_at)
VALUES ('巧克力也有心吗-2021', 'photography', '巧克力也有心吗', NULL, '[![](https://s3.ax1x.com/2021/03/09/68IW5R.md.jpg)](https://imgtu.com/i/68IW5R)

<iframe frameborder="no" border="0" marginwidth="0" marginheight="0" width="330" height="86" src="//music.163.com/outchain/player?type=2&id=1478119336&auto=1&height=66"></iframe>

巧克力有心吗，
它是核桃还是松子。
我把巧克力埋在土里，
用牛奶给他施肥，
我希望来年的春天，
能够看到蜜蜂,
一只为它歌唱的蜜蜂，
也许是一只蝴蝶，
为它跳舞的蝴蝶。
但我等来的却是蚂蚁，
一只永远没法离开土地的蚂蚁，
一直守护蚁巢，守护蚁后的蚂蚁。
它用它短短的触须，
在巧克力上抚摸，
它以为它能摸到春天，
它以为它能度过冬天。

突然刮了一阵风，
一阵从我口中挂起的风，
也许还夹杂着昨天的韭菜的风。
它飞了起来，
它没有成为蜜蜂，
没有成为蝴蝶。
它重重摔到了地上，
它抬头看了我一眼，
我知道它并不知道我是谁，
我也不知道。

它很累，
它很努力，
它曾经看见过天上的蚂蚁，
今天它成为了五秒钟的它们。
可是它不想成为它们，
它只想亲吻大地，
亲吻它的妻子。
它是一直蚂蚁，
一直找不到家了的蚂蚁。
风带它来了这里，
却没有告诉它回家的路。
这里成为了它的新家，
没有一切的家，
但是好像它本来重来就没有什么，
有的只有晚上的头疼，
有的只是一阵风，
带来了新的家的风。

菠萝是黄色的，
饼干是黄色的，
土地是黄色的，
我是什么颜色，
黄色？
或者一抔在土里的黑色。', '2021-03-09', 0, datetime('now'), datetime('now'))
ON CONFLICT(slug) DO UPDATE SET body_md=excluded.body_md, title=excluded.title, pub_date=excluded.pub_date, updated_at=datetime('now');
INSERT INTO articles (slug, collection, title, description, body_md, pub_date, draft, created_at, updated_at)
VALUES ('大树-2021', 'photography', '大 树', NULL, '大 树

[![](https://s3.ax1x.com/2021/03/13/6wMK4s.jpg)](https://imgtu.com/i/6wMK4s)

<iframe frameborder="no" border="0" marginwidth="0" marginheight="0" width="330" height="86" src="//music.163.com/outchain/player?type=2&id=1375524894&auto=1&height=66"></iframe>

我家门前有棵大树，
它弯曲着，
孤零零的躺在红色的泥土中。
秋天长满了黄色的果子，
到了春天又什么都没有落下，
只是结出白色的花。

一年冬天，
飞来了只瘸腿的鸟，
它耷拉着脑袋，
左顾右盼，
不知为何，
它爱上了这里。
又不知在何时，
不知在何处，
它叼来一些蒲公英的种子，
在树上安了家。

我出门是总是撞见这只古怪的鸟，
印象里它总是不停的在飞，
打着圈的飞，
围绕着一朵像对面邻居家娃娃屁股般雪白的花飞。
它好像扇走了雨水，
扇走了落叶，
也扇走了时光。

到了秋天，
树似乎更加佝偻，
摇摇欲坠。
坐在树下，
我时而抬头看天，
忽而俯首望地。
树上什么都没有，
地上也什么也没有，
只剩下一只不停挥动翅膀的鸟，
和一朵没有春天的花。', '2021-03-13', 0, datetime('now'), datetime('now'))
ON CONFLICT(slug) DO UPDATE SET body_md=excluded.body_md, title=excluded.title, pub_date=excluded.pub_date, updated_at=datetime('now');
INSERT INTO articles (slug, collection, title, description, body_md, pub_date, draft, created_at, updated_at)
VALUES ('记忆中的诗-2021', 'photography', '记 忆 中 的 诗', NULL, '[![](https://s3.ax1x.com/2021/03/15/6rKXHf.jpg)](https://imgtu.com/i/6rKXHf)

<iframe frameborder="no" border="0" marginwidth="0" marginheight="0" width="330" height="86" src="//music.163.com/outchain/player?type=2&id=1412022967&auto=1&height=66"></iframe>

-
我和她未曾开始过，
她叫我别等了 不会有结果的。
我甘心做一介阍者 她却和我说：
“你不愿意种花，
你说：“我不愿看见它，一点点凋落。”
是的，
为了避免结束，
你避免了一切开始。”
我自我安慰道“原来是害怕我凋落”。

-
我不知道该怎么和生活中无法失去的人说再见，所以我没有说再见就离开了。

-
后来我发现世界其实真的很大，没有刻意地见面,就真的没有见过了。

-
虽然我很喜欢她，但始终没有告诉她。因为我知道得不到的东西永远是最好的。
​

-
One day you will have to shake hands with all the memories peacefully.
Both she and you were there, with her youth and your best years.
That person will live in the time forever, neither can you pull her out,
nor you can go back inside, just stay how it is, let her stay there quietly.
She won’t become fat with age rising, she won’t be old,
she won’t wear a professional suit with high heels, and she won’t become a house-wife.
She will always be young and always beautiful, wearing a bright dress and standing there in the memory,
smiling at you like she always does.

你总有一天要跟所有的记忆相安无事握手言和，
那里面有她也有你，有她的青春也有你的年华。
那个人永远活在时间里了，你把她拉不出来，自己也回不去，就这样吧，
让她安静的留在那里。她不会发福,不会老去,不会穿着职业套装高跟鞋,不会带着家长里短柴油米醋的气息，
她永远年轻,永远漂亮,穿着鲜艳长裙站在回忆里，对着你笑靥如花。

-
村上春树有一句话“我告诉你我喜欢你，并不是一定要和你在一起，只是希望今后的你，
在遭遇人生低谷的时候，不要灰心，至少曾经有人被你的魅力所吸引，曾经是，以后也会是”

-
那时我们有梦，关于文学，关于爱情，关于穿越世界的旅行。
如今我们深夜饮酒，杯子碰到一起，都是梦破碎的声音。      —北岛《波兰来客》

-
其实”醉生梦死“只不过是她跟我开的一个玩笑，你越想知道自己是不是忘记的时候，
你反而记得更清楚。我曾经听人说过，当你不能够再拥有，你唯一可以做的，就是令自己不要忘记。
不知道从什么时候开始，在什么东西上面都有个日期，秋刀鱼会过期，肉罐头会过期，连保鲜纸都会过期，
我开始怀疑，在这个世界上，还有什么东西是不会过期的？

-
突然刮来一阵风，不知从何而来，它似乎很匆忙，匆忙地带走了一朵花，一片叶， 还有那刚刚升起的一缕烟。

-
钓了条鱼，很高兴。可是鱼跑了，剩下满手的鱼腥味儿，怎么洗也洗不掉。

-
一切文学哲学宗教虽路径各不相同，而其最高境界皆是追求真理。故于诗，可得一转语曰：“此众无枝叶，唯有诸真实。”——顾随

-
梵高：“尽管有许多杂物，生命还是像一则童话故事。”

-
“蒙上雾气的窗子使我感到呼愁，我依然喜欢起身走向这样的窗户，用指尖在窗上写字”

-
尼采：“每个人内心都是一座尸横遍野的战场。”

-
“我们一路奋战，不是为了改变这个世界，而是为了不让这个世界改变我们。”

-
以前的我总在树下，而现在我能看到树叶的曳动和天空。

-
为了寻找你，
我搬进鸟的眼睛，
经常盯着路过的风。

-
人生是一场秀，真的我，活在你的瞳孔里。

-
我们总是被告知 要杀出一条属于自己的路 也许这就是结局 但你永远都不知道。

-
后海有树的院子
夏代有工的玉
此时此刻的云
和二十来岁的你

-
白云随风去，山海无相依。
灯火长相依，月色是秘密。 ​​​
你我皆非仙，心随万事迁。

-
春有百花秋有月，夏有凉风冬有雪。

-
“旅行这东西在本质上无非就是吸入空气。记忆会消失，明信片会褪色，但空气会留下来，至少某种空气会剩留下来。”——村上春树

-
周国平先说过，独处是灵魂的生长空间和神秘力量的对话。

-
白马驮经事已空，断碑残刹见遗踪。

-
它们把公鸡杀了，以为天就不会亮了。

-
“搞怪的不是红绿灯，不是时机，而是我数不清的犹豫。”

-
王尔德，My wallpaper and i are fighting a duel to death. One or the other has to go。

-
山自重，不失其威峻；海自重，不失其雄浑；人自重，不失其尊严。

-
其实”醉生梦死“只不过是她跟我开的一个玩笑，你越想知道自己是不是忘记的时候，
你反而记得更清楚。我曾经听人说过，当你不能够再拥有，你唯一可以做的，就是令自己不要忘记。

-
我选择留在我自己的岁月里了。

-
无论是下到地界还是登上王位，独自旅行的人走得最快。

-
草在结它的种子，风在摇它的叶子，我们站着，不说话，就十分美好。   —顾城

-
我坐在台阶上等风，月亮消失了，光也消失了。

-
梦是生活的倒影，现实是梦的延续。

-
人生三分，一分无奈，一分荒唐，一分寂灭。细想来，不是烟火，便是离人泪。

-
风有声音，雨有声音，可是太阳没有。

我们的短暂生命，很可能就是表现天意的瞬息。漫漫暮色裹住了屋舍，这暮色属于昨天、属于今日，滞留不去。——博尔赫斯《黄昏》

一切文学哲学宗教虽路径各不相同，而其最高境界皆是追求真理。故于诗，可得一转语曰：“此众无枝叶，唯有诸真实。”——顾随

-
以前我看到，
“所爱隔山海，山海不可平”。
那时我觉得，
“海有舟可渡，山有路可行”。
后来才发现，
“山海皆可平，难平是人心”。

-
反正我不会跑，你不必每次都如此迷人。

-
春天的花是冬天的梦。

-
这个世界上只有一种英雄主义，那就是在认清生活真相之后，依然热爱生活。 - 罗曼罗兰

-
往后只剩黑白，但我见过它的绚烂。  - 2015-2019 Pandatv GG

-
列夫·托尔斯泰说：“你不是我，怎知我走过的路，心中的苦与乐。”

-
引用杨绛先生的一句话:”我渐渐明白:那是一个幸运的人对一个不幸者的愧怍。”

-
春暖待花开，花飘蝶自来

-
花能解语添烦恼，石不能言最可人。

-
In solitude, be a multitude to yourself.

-
人生的列车岂止一站，我们会沿着各自的方向，开往不同的地方。

-
歌曰：于山于海，于水于滨，双木非林，田下有心，饮之以雨，炊之以薪，家中有女，马上无邻。

-
多少旧识已不在，惟余桃花开墙头。

-
梦里不知身是客，一饷贪欢

-
时代的一粒灰,落到个人头上,就是一座山。

-
天上星河转，人间帘幕垂。

-
东风夜放花千树，更吹落，星如雨。

-
半醒半醉日复日，花落花开年复年。

-
你生活在光亮里 你就觉得全世界都是光亮的。

-
天台一场雨，烟花布满天。

-
醉后不知天在水，满船清梦压星河。
近来无限伤心事，谁与话长更？从教分付，绿窗红泪，早雁初莺。
当时领略，而今断送，总负多情。忽疑君到，漆灯风飐，痴数春星。

-
去年今日此门中，人面桃花相映红。
人面不知何处去，桃花依旧笑春风。
年年岁岁花相似，岁岁年年人不同。
可叹痴情初相遇，多少往事，都付流年中。

-
似此星辰非昨夜，为谁风露立中宵。

-
春分又入此门中，桃花落尽掩余红。
长情终是成追忆，人面桃花一场空。

-
红酥手，黄縢酒，
满城春色宫墙柳。
东风恶，欢情薄，
一怀愁绪，几年离索。
错！错！错！
春如旧，人空瘦，
泪痕红浥鲛绡透。
桃花落，闲池阁，
山盟虽在，锦书难托。
莫！莫！莫！

世情薄，人情恶，
雨送黄昏花易落。
晓风干，泪痕残。
欲笺心事，独语斜阑。
难！难！难！
人成各，今非昨，
病魂常似秋千索。
角声寒，夜阑珊。
怕人寻问，咽泪装欢。
瞒！瞒！瞒！

-
城南小陌又逢春，只见梅花不见人。
玉骨久成泉下土，墨痕犹锁壁间尘。

-
误入藕花深处。
争渡，争渡，惊起一滩鸥鹭。

-
最热的地方也开始飘雪，冬天才是真的来临。

-
桃华红，李花白，谁道融只一色。
燕子语，黄莺鸣，谁道关关只一声。
不透祖师关捩子，空认山河作眼睛。

-
你应该是一场梦，我应该是一阵风。

-
青山原不老为雪白头，绿水本无忧因风皱面。

-
吹灭读书灯，一身都是月。

-
醉后不知天在水，满船清梦压星河。

-
我也不登天子船，我也不上长安眠。
姑苏城外一茅屋，万树梅花月满天。

-
芦叶满汀洲，寒沙带浅流。
二十年重过南楼。
柳下系船犹未稳，能几日，又中秋。
黄鹤断矶头，故人今在否？
旧江山浑是新愁。
欲买桂花同载酒，终不似，少年游。
恰沐春风共同游，终只叹，木已舟。
只恐双溪舴艋舟，载不动，许多愁。
痴妄佳人共漂流，敌不过，迟暮愁。

-
落魄小生似死囚，唱不尽，孤独忧。

-
画楼帘幕卷新晴。
掩银屏。晓寒轻。
坠粉飘香，日日唤愁生。
暗数十年湖上路，能几度，著娉婷。
年华空自感飘零。
拥春酲。对谁醒。
天阔云间，无处觅箫声。
载酒买花年少事，浑不似，旧心情。

-
what’s the cost of lies?

-
劝君莫惜金缕衣，劝君惜取少年时。
花开堪折直须折，莫待无花空折枝。

-
本是后山人
偶做前堂客
醉舞经阁半卷书
坐井说天阔
大志戏功名
海斗量福祸
待到囊中羞涩时
怒指乾坤错

-
秋风清，秋月明，落叶聚还散，寒鸦栖复惊。

-
蜗牛角上争何事，石火光中寄此身。

-
落日心犹壮，春风病欲苏。

-
待到秋来九月八，我花开后百花杀。
冲天香阵透长安，满城尽带黄金甲。

-
《不要温和地走进那个良夜》 英国诗人狄兰·托马斯

-
本是后山人，
偶做前堂客，
醉舞经阁半卷书。
坐井说天阔，
大志戏功名，
海斗量福祸，
待到囊中羞涩时，
怒指乾坤错。', '2021-03-15', 0, datetime('now'), datetime('now'))
ON CONFLICT(slug) DO UPDATE SET body_md=excluded.body_md, title=excluded.title, pub_date=excluded.pub_date, updated_at=datetime('now');
INSERT INTO articles (slug, collection, title, description, body_md, pub_date, draft, created_at, updated_at)
VALUES ('蘸水的棉签-2021', 'photography', '蘸 水 的 棉 签', NULL, '[![](https://z3.ax1x.com/2021/04/02/cmsY1s.jpg)](https://imgtu.com/i/cmsY1s)

<iframe frameborder="no" border="0" marginwidth="0" marginheight="0" width="330" height="86" src="//music.163.com/outchain/player?type=2&id=1698432&auto=1&height=66"></iframe>

我走在马路上，
听到一声悉索的响声，
我好像落下了时间，
又或是时间丢下了我。
它卷起一片尘埃，
像一只无角的犀牛，
不断奔跑。

我站在原地，
不知道它是否曾回过头，
但我满眼只剩昏黄的尘埃。

我记得有人说过，
我们处于光的时代。
那么时间抛弃了我，
我是不是看到过去，
又或是回到过去？

叮！
一幕幕幻灯片般在我脑海重映，
我被束缚在座椅上，
成为一名孤独的观影者。
我想伸手将它们重新排列，
却发现梦的影子难以延续。

我不想入梦。
那是一片深邃的画幕，
即使偶尔闪现几点星光，
却让心跳无动于衷。
远处的山峦如同一张布满老茧的巨手，
它抚摸大地，
却也抹去了风的感情，
它撕碎汽车，
也埋葬了我年少的记忆。

【后记】
下班后，想了想，还是骑着车来到隔壁小区门口的理发店。常来的地方，今天好像有点不同。
像小偷一样在外面张望了一下，那个叫腰上绑着挎包的胖哥，还有和我一样扎着小辫子的小师哥都难觅踪影，只留几个曾经没有交际的身影在那摆弄剪刀。
其实过去这几个人我都不是很喜欢，毕竟看上去他们自己都无暇估计头上的鸟窝，难以想象他会帮我头上的杂草修剪的怎么样。
不过我还是走了进去，也许是因为我不会拒绝，也许是因为我想知道他们还会不会再回来。
我选择了一个新面孔，其实是我没有选择，这是一张完全陌生的面孔，我不是很相信他，不过后面事实证明，人确实应该尝试和改变。
这里学徒还是后帘小绿毛，洗头期间，我向他问了问两人情况，小绿毛告诉我，胖哥走了，小辫子今天休息就没了下文。
我撇了撇嘴，想到第一次来到这里，红红绿绿的旋转灯是那么相似。
我有个习惯，就是喜欢先看设计师自己的发型判断他的真实审美来决定我要不要成为下一个杀马特。
于是那天在周围转了好几圈，最终还是因为胖哥不知道真假的技术，与他那略显犹(二声)豫的气质选择了这家店。
胖哥总是在腰上一个别着满兜的包，在他那酒桶般的大肚子旁也显得不是很违和，包里装着一大堆工具，看上去很专业，很唬人，
后来也证明了其实剪我这个鸟趴窝不是问题。

写的乱七八糟，就像我的状态一样，更多的今天就先不说了，只是最近感觉眼睛看东西变得模糊了，不知道是时间变得模糊了，还是我要变得模糊了。
人呐，几天不见也许就再也见不到了。人不能走出时间，却又能影响别人的时间。', '2021-04-02', 0, datetime('now'), datetime('now'))
ON CONFLICT(slug) DO UPDATE SET body_md=excluded.body_md, title=excluded.title, pub_date=excluded.pub_date, updated_at=datetime('now');
INSERT INTO articles (slug, collection, title, description, body_md, pub_date, draft, created_at, updated_at)
VALUES ('似水流年-2021', 'photography', '似 水 流 年', NULL, '[![](https://z3.ax1x.com/2021/04/20/cHyx39.jpg)](https://imgtu.com/i/cHyx39)

<iframe frameborder="no" border="0" marginwidth="0" marginheight="0" width="330" height="86" src="//music.163.com/outchain/player?type=2&id=439646570&auto=1&height=66"></iframe>

似水流年是一个人所有的一切，只有这个东西才真正归你所有。其余的一切都是片刻的欢愉与不幸，转眼间就已跑到那似水流年里去了。

我所认识的人，都不珍视自己的似水流年。他们甚至不知道，自己还有这么一件东西，所以一个个像丢了魂一样。

王二在自己的似水流年里，目睹了贺先生跳楼自杀和李先生的龟头血肿，三年后，到云南插队期间，和十五队的陈清扬蹲伟大友谊，即使回到京郊，也有小转铃，有刘先生。三十而立，与二妞子结婚，与线条重逢，与许由回到学校教书育人。

“在其中一界的时候，我们急着去要自己份内的那点东西，丝毫不想它是不是自己想要的。等有了一点自己想要的东西，不管它是署了自己名字的小说，还是西夏文，就已经活到了另一界了。”

在阴阳两界中，我就是他们，他们也成为了我。在硬的时期我活在灯光中，软了以后生活在阴影里。

我不知道王二是否喜欢硬的时期，硬的时期他曾经拥有的，最后都消失了。相反，软了以后他的小和尚却又亲近小孙的帝王将相。

我的似水流年里，有的人就像过去的一首诗，一片叶，脑海中它曾经出现过，但是它被时间渐渐拉长，破碎，只能在只言片语中重拾它的存在。

有的像行驶的列车，看着墙上挂着的钟表，分针和车轮一同摆动，我和列车一同摇晃。明知未来的几点几分它要靠站，可是心中却有未知的期盼。

这时候，我想起王二表哥说过的话：人活在世界上，假如你想要什么，就没有什么，这就是辩证法。所以假如你真想要什么的话，就别去想他。

可是，你越想知道自己是不是忘记的时候，你反而记得更清楚。

我曾经听人说过，当你不能够再拥有，你唯一可以做的，就是令自己不要忘记。

不知道从什么时候开始，在什么东西上面都有个日期，秋刀鱼会过期，肉罐头会过期，连保鲜纸都会过期，

我开始怀疑，

在这个世界上，

还有什么东西是不会过期的？', '2021-04-20', 0, datetime('now'), datetime('now'))
ON CONFLICT(slug) DO UPDATE SET body_md=excluded.body_md, title=excluded.title, pub_date=excluded.pub_date, updated_at=datetime('now');
INSERT INTO articles (slug, collection, title, description, body_md, pub_date, draft, created_at, updated_at)
VALUES ('相由心生，有容乃大-2021', 'photography', '相由心生，有容乃大', NULL, '[![](https://z3.ax1x.com/2021/05/16/gchhdK.png)](https://imgtu.com/i/gchhdK)

<iframe frameborder="no" border="0" marginwidth="0" marginheight="0" width="330" height="86" src="//music.163.com/outchain/player?type=2&id=32957042&auto=1&height=66"></iframe>

佛曰：命由己造，相由心生，世间万物皆是化相，心不动，万物皆不动，心不变，万物皆不变。种如是因，收如是果，一切唯心造。

如果常用眼睛丈量世界，也许看的的不过是不同频段的光谱，映射在锥状细胞和杆状细胞上，刺激着大脑皮层分泌多巴胺，产生片刻的欢愉。

想起前几年网上流传的蓝黑/白金裙子，颜色有固有性吗，又或者我们如何通过控制光来保持颜色。光线也许可以控制其明暗、色散程度，但是社会经验、视觉细胞活跃程度，或者大脑的固有印象却因人而异。

我把它抽象为心的记忆是不同的。什么是美，什么是美相？仓央加措曾有这么一篇文章，其问佛∶为何不给所有女子羞花闭月容颜？

佛曰∶那只是昙花一现，用来蒙蔽世俗的眼，没有什麽美可以抵过一颗纯净仁爱的心，我把它赐给每一个女子，可有人让她蒙上了灰。', '2021-05-15', 0, datetime('now'), datetime('now'))
ON CONFLICT(slug) DO UPDATE SET body_md=excluded.body_md, title=excluded.title, pub_date=excluded.pub_date, updated_at=datetime('now');
INSERT INTO articles (slug, collection, title, description, body_md, pub_date, draft, created_at, updated_at)
VALUES ('蓝色的山-2021', 'photography', '蓝 色 的 山', NULL, '[![](https://z3.ax1x.com/2021/06/03/28e4fA.jpg)](https://imgtu.com/i/28e4fA)

<iframe frameborder="no" border="0" marginwidth="0" marginheight="0" width="330" height="86" src="//music.163.com/outchain/player?type=2&id=521264673&auto=1&height=66"></iframe>

蓝色幕布下隐藏着血色的砖与绿色的草。

- 前言 -

这地方真好，旁边就是公路和铁路，能听到喇叭声，能看到老绿色火车，抬头还经常有飞机飞过。对了，它里面还有地下河，真有意思。

不过看上去这地方也不会存在很久，可能也不会有多少人找得到，因为我看到了一天长满草的小路，出于摄影的直觉，就无意中看到了这个地方，它应该是有两个大门，现在都不让进了，我进来看到一个大爷，也许不是我对他笑了笑，我也被赶出去了。

想了想好久没有这么亲近土地了，果然是没有人的地方才能看到最真实的自己。这里动物都不怎么怕人啊，连小臭屁虫都欺负到我头上了。随便找了根小树枝，逗逗小工兵蚁，把鼠妇翻个个，在给农作物浇点肥，真好。

我在这坐了一下午，准备写完这片分享离开的时候，发现老头翻墙到隔壁小区离开了，真逗。在出口又看到两个保安，所以诀窍应该是中午吃饭的时候进去。

-
杂记 -
微风拂来
蓝色的外衣下掩盖着血色的砖块
一抹绿色冲破这脆弱的皮肤
最后嗅到的却是汽油的苦腥与发动机的轰鸣

-
冥想 -
拍这个图片又让我想起了之前想要拍的城市与发展的主题，这蓝色幕布隐藏着血色的砖头，让我想起了自己，我们不也是站在一片蓝色的帷幕下吗，我们就像砖缝中的蚂蚁，或许又是土壤下的种子。也许我们可以像植被一般冲出自己的世界，也许在新的发展中又会被推平成为干枯的树枝。', '2021-06-03', 0, datetime('now'), datetime('now'))
ON CONFLICT(slug) DO UPDATE SET body_md=excluded.body_md, title=excluded.title, pub_date=excluded.pub_date, updated_at=datetime('now');
INSERT INTO articles (slug, collection, title, description, body_md, pub_date, draft, created_at, updated_at)
VALUES ('出圈-2021', 'photography', '出 圈', NULL, '**不要去仰望天空**

[![](https://z3.ax1x.com/2021/07/04/Rfkn9s.png)](https://imgtu.com/i/Rfkn9s)

<iframe frameborder="no" border="0" marginwidth="0" marginheight="0" width="330" height="86" src="//music.163.com/outchain/player?type=2&id=441722&auto=1&height=66"></iframe>

如果科学是理性，艺术是感性。

什么是科学。集体潜意识中的心理分析，弗洛伊德提出精神分析算科学吗，算卦风水算科学吗。如果可以验证的算科学，无法解释的杨氏双缝干涉为代表的量子力学可以被称为科学吗。

什么叫艺术。梵高，维维安，舒伯特生前的作品集算不算艺术，为什么死后成为经典。它们原来就是时代的先驱，如果没有高更，马鲁夫，如果作品躺在灰尘中，他们是否会成为最高层次的艺术品。<泉>是艺术是因为他本身是艺术，还是赋予的属性让它成为了艺术。博伊斯说，人人都是艺术家，随手的画，赋予了你的思想，算艺术吗。

如果用理性的思维看感性，那么什么是艺术，如果用感性的思维看理性，那么什么是科学。它们边界在哪？是那个圈吗。不在圈内的人，却被一个个圈无形的束缚，可他们同样有着自己的一个圈，束缚着别人。', '2021-07-01', 0, datetime('now'), datetime('now'))
ON CONFLICT(slug) DO UPDATE SET body_md=excluded.body_md, title=excluded.title, pub_date=excluded.pub_date, updated_at=datetime('now');