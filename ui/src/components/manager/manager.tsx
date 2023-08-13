import PUYUC, {IChatItem} from 'chat-webkit'
import { useContext, useState, useEffect, useRef } from 'react';
import { IdContext } from '@/utils/idcontexts';
import style from './manager.module.less';
import { ModelContext } from '@/utils/modelcontext';
import eventBus from '@/utils/eventBus';
import {sessionMesage} from '@/utils/sessionInterface'
import { ModeContext, ModeContextProps } from '@/utils/contexts';

interface ChatItem extends IChatItem {
    notAnnotated: boolean;
    mode: string;
}
/**
 * 至少保持开启一个会话。
 */
function Manager() {
  // 模式控制的
    const modeContext = useContext(ModeContext)?.mode
    const setModeContext = useContext(ModeContext)?.setMode
    console.log(modeContext, "manager mode")
    // 会话是否禁用的开关
    const [banSession, setBanSession] = useState(false);

    const idContext = useContext(IdContext);
    const models = useContext(ModelContext)?.models;
    const numOfModel = models?.length;
    const initSession: sessionMesage = {};
    const [curChatId, setCurChatId] = useState<string>(idContext?.id!)
    const [chatList, setChatList] = useState<ChatItem[]>([{
        id: idContext?.id!,
        name: '初始化会话',
        notAnnotated: true,
        mode: modeContext!
    }])
    const prevMyStateRef = useRef(modeContext);
    // if(localStorage.getItem(modeContext!) != undefined && localStorage.getItem(modeContext!)!== null){
    //     // 加载保存的会话列表
    //     const chatlist_state = JSON.parse(localStorage.getItem(modeContext!)!);
    //     const new_chatList = chatlist_state["chatlist"]
    //     const session_id = chatlist_state["session_id"]
    //     idContext?.setId(session_id)
    //     setChatList(new_chatList)
    // }
    for (let i = 0; i < numOfModel!; i++) {
        if (models) initSession[models[i].model_id] = [];
    }
    /**TODO：防止溢出 */
    if (localStorage.getItem(idContext?.id!) == undefined || null) {
        localStorage.setItem(idContext?.id!, JSON.stringify(initSession));
    }

    const addChat = (modecontext: string, chatList: ChatItem[]) => {
        console.log(modecontext, "add chat111111111")
        const newItem = {
            id: Date.now().toString(),
            name: '新会话' + Date.now().toString(),
            notAnnotated: true,
            mode: modecontext
        }
        const newList = chatList.slice()  // 复制数组
        newList.unshift(newItem)   // 向数组开头添加元素
        setChatList(newList)
         /**新增后会立即选中当前的sessionid */
         setCurChatId(newItem.id)
         eventBus.emit('banInputEvent', false)

        //  eventBus.emit('sendStatus', true)
        //  eventBus.emit('input', true)
         idContext?.setId(newItem.id)
        /**初始化缓存 */
        const numOfModel = models?.length;
        const initSession: sessionMesage = {};
        for (let i = 0; i < numOfModel!; i++) {
            if (models) initSession[models[i].model_id] = [];
        }
        console.log("addchat", newItem.id)
        console.log(chatList)
        localStorage.setItem(newItem.id, JSON.stringify(initSession))
    }

    const deleteChat = (id: string) => {
        const newList = chatList.slice();
        const index = chatList.findIndex((x) => x.id === id);
        if (chatList.length >= 1) {
            newList.splice(index, 1);
            setChatList(newList);
            if (index != 0) {
                selectChat(chatList[index - 1].id);
            } else {
                selectChat(chatList[chatList.length - 2].id);
            }
        }
    };

    const annotateChat = (id: string) => {
        const index = chatList.findIndex((x) => x.id === id);
        console.log('正在标注', index);
        chatList[index]['notAnnotated'] = false;
        eventBus.emit('sendStatus', chatList[index]['notAnnotated']);
    };

    const selectChat = (id:string) => {
        setCurChatId(id)
        idContext?.setId(id)
        const index = chatList.findIndex(x => x.id === id)
        // 判断是否禁用输入框
        eventBus.emit('banInputEvent', !chatList[index]['notAnnotated'])
        // eventBus.emit('sendStatus', chatList[index]['notAnnotated'])
    }

    const setMode = (mode: string, sessionId: string) => {
      const index = chatList.findIndex(x => x.id === sessionId)
      chatList[index]['mode'] = mode
    }
    // 监听单会话标注是否完成， 完成将sessionList的标注置为可对话
    useEffect(()=>{
        const CurSessionAnnatote = (finishBtn: boolean, id: string) => {
            const index = chatList.findIndex(x => x.id === id)
            // const newChatList = chatList.slice()
            chatList[index].notAnnotated = finishBtn
            console.log("[Debug] manager.tsx" + "cursessionAnnatote :" + chatList + "session_id: " + id)
            setChatList(chatList)
        }
        eventBus.on("annotateSession", CurSessionAnnatote)
        return () => {
          eventBus.off("annotateSession", CurSessionAnnatote)
        }
    })

    // 监听对话框是否发送消息， 如果发送就要禁用掉会话栏
    useEffect(()=>{
      const banSessionList = (banButton: boolean)=>{
        setBanSession(banButton);
      }
      eventBus.on('banSessionList', banSessionList)

      return () => {
        eventBus.off('banSessionList', banSessionList)
      }
    })


    // 监听模式的变化, 一旦变化就切换展示的会话信息
    useEffect(()=>{
      console.log(chatList, idContext?.id, "manger mode_change effect", prevMyStateRef.current)
      if(prevMyStateRef.current != modeContext){
        console.log('myState 变化了:', prevMyStateRef.current, '=>', modeContext);
        const sessionSate = {
          "chatlist": chatList,
          "session_id": idContext?.id
        }
        // 变化了，存储或者更新 会话列表
        localStorage.setItem(prevMyStateRef.current!, JSON.stringify(sessionSate))
        // 读取切换的模式的会话列表
        if(localStorage.getItem(modeContext!) != undefined && localStorage.getItem(modeContext!)!== null){
            const chatlist_state = JSON.parse(localStorage.getItem(modeContext!)!);
            const new_chatList: ChatItem[] = chatlist_state["chatlist"]
            const session_id = chatlist_state["session_id"]
             // 切换模式时候判断是否开启对话框
             const index = new_chatList.findIndex(x => x.id === session_id)
            idContext?.setId(session_id)
            setChatList(new_chatList)
            setCurChatId(session_id)
            // selectChat(session_id)
            eventBus.emit("banInputEvent", true)
            console.log("[Debug] manager.tsx session_id:", session_id, index, new_chatList, !new_chatList[index]['notAnnotated'])
        }else{
          addChat(modeContext!, [])
        }
        prevMyStateRef.current = modeContext
      }
      
    }, [modeContext])

    useEffect(() => {
      const annotateListener = (sessionId: string) => {
        console.log('想要标注的session', sessionId)
        annotateChat(sessionId)
      }
      const modeListener = (mode: string, sessionId: string) => {
        console.log('模式', mode, 'sessionId', sessionId)
        setMode(mode, sessionId)
      }
      const findMode = (sessionId: string) => {
        const index = chatList.findIndex(x => x.id === sessionId)
        useContext(ModeContext)?.setMode(chatList[index]['mode'])
      }
      // eventBus.on('dialogueFinish', annotateListener)
      // eventBus.on('setMode', modeListener)
      // eventBus.on('findMode', findMode)
      return () => {
        eventBus.removeListener('dialogueFinish', annotateListener)
        eventBus.removeListener('setMode', modeListener)
        eventBus.removeListener('findMode', findMode)
      }
  }, []);

    return (
        <div className={style.chatmanagement} style={banSession ? {pointerEvents: 'none', opacity: 0.5} : {}}>
            <PUYUC.ChatManagement  
                list={chatList} 
                selectedChatId={curChatId}
                addCallback={()=>addChat(modeContext!, chatList)} 
                deleteCallback={deleteChat} 
                selectCallback={selectChat} 
            />
        </div>
    );
}

export default Manager;
